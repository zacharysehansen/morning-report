// Robust extraction of agent output.
//
// Agents in this pipeline return output in one of three shapes:
//   1. Plain text / JSON straight on stdout (the Claude CLI wrapper).
//   2. An NDJSON stream of {"response":"..."} chunks with \uXXXX escaping
//      (the original Ollama-style curation node).
//   3. opencode's `--format json` NDJSON event stream, where each line is
//      {"type":..., "part":{...}} and only the "text" parts are the answer.
// These helpers normalise all three, then best-effort salvage JSON out of
// prose or ```json fences so a chatty model still parses.

// Turn literal backslash-u escape sequences into real characters.
function unescapeUnicode(s) {
  return s
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

// SGR colour codes and the odd cursor move. opencode keeps these to stderr,
// but any agent swapped in behind the wrapper may not be so tidy, and a stray
// escape sequence inside a JSON string is not recoverable further down.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

// Pull the assistant's text out of one opencode event. Returns null for
// anything that is not assistant prose — step markers, tool calls, the
// end-of-session summary — so none of it can reach the parser.
function opencodeText(obj) {
  if (!obj || obj.type !== "text") return null;
  const part = obj.part;
  if (!part || part.type !== "text") return null;
  return typeof part.text === "string" ? part.text : null;
}

// Collapse an NDJSON stream into its concatenated text. If the input is not
// such a stream, return it unchanged. ANSI is stripped and unicode escapes
// are decoded either way.
export function coalesceText(raw) {
  const text = (typeof raw === "string" ? raw : String(raw ?? "")).replace(
    ANSI,
    "",
  );
  const chunks = [];
  let sawEvent = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      // Shape 2: Ollama-style {"response": "..."}.
      if (typeof obj.response === "string") {
        chunks.push(obj.response);
        sawEvent = true;
        continue;
      }
      // Shape 3: opencode --format json.
      const t = opencodeText(obj);
      if (t !== null) {
        chunks.push(t);
        sawEvent = true;
      } else if (typeof obj.type === "string" && obj.sessionID) {
        // A recognised opencode event that carries no prose (step_start,
        // tool, step_finish). Mark the stream as understood so its noise is
        // dropped rather than falling through to the raw-text branch.
        sawEvent = true;
      }
    } catch {
      // not an NDJSON line — ignore
    }
  }
  return unescapeUnicode(sawEvent ? chunks.join("") : text);
}

// Return the substring from the first `open` to its matching `close`,
// respecting string literals and escapes. Null if unbalanced/absent.
function sliceBalanced(s, open, close) {
  const start = s.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// Best-effort parse of a JSON value out of an agent reply. Returns the parsed
// value, or undefined if nothing usable was found.
export function extractJson(raw) {
  const text = coalesceText(raw).trim();
  if (!text) return undefined;

  // 1. The happy path: the whole thing is valid JSON.
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }

  // 2. Fenced block: ```json ... ``` or ``` ... ```
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* fall through */
    }
  }

  // 3. Grab the first balanced array or object embedded in prose.
  for (const [open, close] of [
    ["[", "]"],
    ["{", "}"],
  ]) {
    const span = sliceBalanced(text, open, close);
    if (span) {
      try {
        return JSON.parse(span);
      } catch {
        /* keep trying */
      }
    }
  }

  return undefined;
}
