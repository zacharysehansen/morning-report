// Invokes the agent wrapper (ask_the_agent.ps1) once and returns its raw
// stdout. The ANTHROPIC_* variables are still cleared as the original .ps1
// nodes did; they are inert now that the wrapper drives opencode, but a stale
// one in the n8n service environment could still confuse a future backend.
//
// The prompt is passed via a temp file rather than inline on the command line,
// so long prompts full of quotes and newlines can't break the shell quoting.
// The wrapper then hands the text to the agent on stdin — passing it as a
// native-command argument is what PowerShell 5.1 strips quotes out of.
//
// The wrapper is asked for `--format json`, an NDJSON event stream, rather
// than its human-formatted output. The formatted output interleaves the
// answer with tool traces and end-of-session summaries that are impossible to
// separate reliably; the event stream tags each piece, so parse.js can keep
// the assistant text and drop everything else.

import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../config.js";

// `isComplete(textSoFar)` lets the caller say when the output is already good
// enough. The agent keeps a session alive well past the point where it has
// emitted the answer, so waiting for it to exit on its own adds minutes per
// source. The caller knows what "done" means — a JSON array that validates, a
// fragment that looks like HTML — so as soon as it says so, the process tree
// is torn down and the next source starts.
export function runAgent(
  prompt,
  {
    timeoutMs = config.agent.timeoutMs,
    idleMs = config.agent.idleMs,
    isComplete,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "morning-report-"));
    const promptFile = join(dir, "prompt.txt");
    writeFileSync(promptFile, prompt, "utf8");

    // Single-quote a path for a PowerShell literal string.
    const psPath = `'${promptFile.replace(/'/g, "''")}'`;
    // ReadAllText with an explicit UTF-8 encoding, not Get-Content: writeFileSync
    // emits UTF-8 without a BOM, and BOM-less is exactly the case where
    // PowerShell 5.1's Get-Content falls back to the ANSI code page. The
    // curation prompt carries scraped titles full of accents and dashes.
    const command = [
      "Remove-Item Env:ANTHROPIC_BASE_URL -ErrorAction SilentlyContinue;",
      "Remove-Item Env:ANTHROPIC_AUTH_TOKEN -ErrorAction SilentlyContinue;",
      `$prompt = [System.IO.File]::ReadAllText(${psPath}, [System.Text.Encoding]::UTF8);`,
      [
        config.agent.script,
        "-prompt $prompt",
        `-mode '${config.agent.mode}'`,
        ...config.agent.extraArgs,
      ].join(" "),
    ].join(" ");

    const child = spawn(config.agent.shell, [...config.agent.shellArgs, command], {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    // child.kill() only reaches the shell. The agent itself is a grandchild
    // (powershell -> opencode -> node), and orphaning it leaves a process
    // still holding the model on the GPU, which slows every later attempt in
    // the same run. taskkill /T takes the whole tree down.
    //
    // Synchronously, on purpose. Spawning taskkill and moving on returns
    // before the tree is actually gone, so the next source starts while the
    // previous opencode is still up and still holding its SQLite session
    // database — the "database is locked" collision that burns a source's
    // whole attempt budget. Waiting costs milliseconds.
    const killTree = () => {
      if (process.platform === "win32" && child.pid) {
        try {
          execFileSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            stdio: "ignore",
            timeout: 10_000,
            windowsHide: true,
          });
        } catch {
          /* already gone, or only partly — fall through to the plain kill */
        }
      }
      child.kill();
    };

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      // Let go of the child's pipes. Resolving the promise is not enough: a
      // piped stdio stream is a ref'd handle, so as long as one is open the
      // event loop cannot drain and node cannot exit. The pipe only reaches
      // EOF once *every* writer closes it, and taskkill does not reliably
      // reach the opencode grandchild — it detaches from the shell we killed
      // and survives. Without this, a run that has already printed its
      // finished HTML sits forever holding the ssh channel open, and the n8n
      // execution never completes.
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners("close");
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        try {
          stream?.destroy();
        } catch {
          /* best effort */
        }
      }
      child.unref();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
      fn(arg);
    };

    // Hard ceiling. With early completion and the idle timer below this should
    // never be what stops a run; it is only here so a wedged process cannot
    // pin a slot forever.
    const timer = setTimeout(() => {
      killTree();
      finish(reject, new Error(`agent timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // A healthy agent streams events continuously — step markers, tool calls,
    // text. Silence means it is stuck, and that is worth giving up on in
    // seconds rather than sitting out the full ceiling.
    let idleTimer;
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        killTree();
        finish(
          reject,
          new Error(`agent produced no output for ${idleMs}ms — giving up`),
        );
      }, idleMs);
    };
    resetIdle();

    // Decode as UTF-8 through a StringDecoder rather than concatenating raw
    // Buffers: an accented character landing on a chunk boundary would
    // otherwise be split into two invalid halves.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (d) => {
      stdout += d;
      resetIdle();
      // The event stream is newline-delimited, so a chunk without one cannot
      // have completed an event — no point re-parsing until it does.
      if (!isComplete || !d.includes("\n")) return;
      let done = false;
      try {
        done = isComplete(stdout);
      } catch {
        // A predicate that throws on partial output is not a reason to fail
        // the call; just keep reading.
      }
      if (done) {
        killTree();
        finish(resolve, stdout);
      }
    });

    child.stderr.on("data", (d) => {
      stderr += d;
      resetIdle();
    });
    child.on("error", (err) =>
      finish(
        reject,
        new Error(
          `failed to launch agent (${config.agent.shell} / ${config.agent.script}): ${err.message}`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        return finish(
          reject,
          new Error(`agent exited with code ${code}: ${stderr.trim().slice(0, 500)}`),
        );
      }
      // A clean exit that produced nothing is a failure, not an empty answer.
      // The wrapper can exit 0 having never reached the model at all — a
      // missing PATH entry or a stopped Ollama both look like this — and
      // without the check it surfaces downstream as the far less useful
      // "no JSON could be parsed from the output".
      if (!stdout.trim()) {
        return finish(
          reject,
          new Error(
            `agent exited 0 but produced no output. stderr: ${
              stderr.trim().slice(0, 500) || "(empty)"
            }`,
          ),
        );
      }
      finish(resolve, stdout);
    });
  });
}
