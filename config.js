// Central configuration for the morning-report pipeline.
// Everything an operator is likely to tweak lives here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Which model ask_the_agent.ps1 should run (its -mode argument).
//
// A mode only resolves if its model is declared under provider.ollama.models
// in ~/.config/opencode/opencode.json. Pulling it in Ollama is not enough:
// qwen3.6-96k is pulled but undeclared, which is why `local` used to fail.
// Cloud models are the exception — they come from opencode's own registry.
//
//   LOCAL - ollama/qwen3.6-64k, the 27B dense build, num_ctx 65536 (matching
//           the declared limit.context). The default: it runs on this host's
//           own GPU, costs nothing per run, and — unlike AUTO — genuinely
//           calls webfetch. Verified returning live Loft URLs that resolve.
//   CLOUD - ollama-cloud/gpt-oss:120b. Also fetches correctly, and is the
//           strongest of the three, but it is the slowest: it fans out into
//           sub-agent searches and a single source can exceed the 10-minute
//           MR_AGENT_TIMEOUT_MS backstop. Needs no block in opencode.json,
//           only OLLAMA_API_KEY, which opencode reads from the environment
//           (`opencode auth list` shows it under Environment).
//           NOTE: that variable is set at *User* scope, so a service running
//           as another account will not see it. Move it to Machine scope if
//           n8n ever runs as someone other than the interactive user.
//   AUTO  - ollama/qwen3:30b-a3b, the 30B MoE. Fast, but it fabricates: it
//           answers scrape prompts from memory with invented events and 404
//           URLs that still satisfy schema validation, so the digest looks
//           healthy and is wrong. Do not use it for this pipeline.
export const AGENT_MODE = Object.freeze({
  CLOUD: "cloud",
  AUTO: "auto",
  LOCAL: "local",
});

// The default the whole project uses. Flip this one line to switch, or override
// per-run with the MR_AGENT_MODE environment variable (e.g. MR_AGENT_MODE=auto).
const DEFAULT_AGENT_MODE = AGENT_MODE.LOCAL;

// Resolve the effective mode, tolerating any casing and rejecting bad values.
function resolveAgentMode(raw) {
  if (!raw) return DEFAULT_AGENT_MODE;
  const value = String(raw).trim().toLowerCase();
  const valid = Object.values(AGENT_MODE);
  if (!valid.includes(value)) {
    throw new Error(
      `Invalid agent mode "${raw}". Expected one of: ${valid.join(", ")}.`,
    );
  }
  return value;
}

// The curation prompt is kept in a plain-text file so it can be edited
// without touching code. {{RESULTS}} is substituted with the merged data.
const curationPromptTemplate = readFileSync(
  join(__dirname, "prompts", "curation.txt"),
  "utf8",
);

export const config = {
  // How the agent wrapper is invoked.
  agent: {
    shell: process.env.MR_SHELL || "powershell.exe",
    shellArgs: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"],
    // Script/command the shell command invokes. Must accept -prompt and -mode.
    //
    // Absolute by default, deliberately. The bare name "ask_the_agent.ps1"
    // resolves only because the interactive profile
    // (Microsoft.PowerShell_profile.ps1) appends its directory to $env:Path.
    // We spawn with -NoProfile, so the child sees that directory only when the
    // node process it inherited from was itself started from a shell that had
    // loaded the profile. That is true by hand and false under the n8n service
    // account, where every source then fails with "ask_the_agent.ps1 is not
    // recognized" and the digest goes out empty.
    script:
      process.env.MR_AGENT_SCRIPT ||
      "C:\\Users\\Zachary\\Documents\\Agent\\ask_the_agent.ps1",
    mode: resolveAgentMode(process.env.MR_AGENT_MODE),
    // Forwarded to the wrapper's -passthrough, i.e. straight on to opencode.
    //   --format json  the NDJSON event stream instead of the formatted
    //                  transcript, so parse.js can take the assistant text and
    //                  leave tool traces and session summaries behind.
    //   --agent digest the agent defined in this project's opencode.json.
    //                  opencode's stock 'build' agent is a coding assistant and
    //                  answers roughly half of these prompts with "I can only
    //                  assist with software engineering tasks" — that refusal,
    //                  not any fetch failure, is what emptied the digest.
    extraArgs: (process.env.MR_AGENT_ARGS || "--format json --agent digest")
      .split(/\s+/)
      .filter(Boolean),
    // Backstop only. Calls normally end the instant the reply is usable (see
    // runAgent's isComplete), so this exists purely to stop a wedged process
    // from pinning a concurrency slot. (ms)
    timeoutMs: Number(process.env.MR_AGENT_TIMEOUT_MS || 10 * 60 * 1000),
    // How long the agent may go completely SILENT before it counts as stuck —
    // this is a gap between events, not total run time. Events arrive at step
    // boundaries, and the gap spanning a page fetch plus generation has been
    // measured at over two minutes on this host, so the window has to clear
    // that comfortably or it would kill healthy calls. (ms)
    idleMs: Number(process.env.MR_AGENT_IDLE_MS || 4 * 60 * 1000),
  },

  // Retry / validation policy for every agent call.
  retries: {
    maxAttempts: Number(process.env.MR_MAX_ATTEMPTS || 3),
    // Linear backoff: attempt N waits backoffMs * N before the next try.
    backoffMs: Number(process.env.MR_BACKOFF_MS || 2000),
  },

  // How many source scrapers may run at once.
  //
  // Must stay at 1. opencode keeps its session state in a SQLite database, and
  // two concurrent `opencode run` processes contend on it: the loser exits 1
  // with "Unexpected error / database is locked", which this pipeline sees as a
  // failed attempt and retries — burning the source's attempt budget on a
  // collision that has nothing to do with the site being scraped. Raise this
  // only if opencode gains per-process session isolation.
  concurrency: Number(process.env.MR_CONCURRENCY || 1),

  // Diagnostics only. When true, failed agent replies are logged (truncated) to
  // stderr so you can see what actually came back. OFF by default: leave it
  // unset in production so no response content is ever recorded.
  debug: process.env.MR_DEBUG === "true",

  curation: {
    promptTemplate: curationPromptTemplate,
  },

  output: {
    // Clean HTML always goes to stdout (pipe it wherever you like).
    // Additionally save a dated copy on disk when true.
    writeFile: process.env.MR_WRITE_FILE !== "false",
    dir: process.env.MR_OUTPUT_DIR || join(__dirname, "output"),
  },

  email: {
    title: process.env.MR_TITLE || "The Digest",
    subtitle: process.env.MR_SUBTITLE || "Zachary's Daily Report",
    footer:
      process.env.MR_FOOTER ||
      "Generated by your homelab · Zachary's Daily Digest",
  },

  banner: {
    // Set MR_BANNER=false to skip image generation (e.g. ComfyUI is offline).
    enabled: process.env.MR_BANNER !== "false",
    // 127.0.0.1, not localhost: ComfyUI binds IPv4 only, and "localhost" on
    // this box resolves to ::1 first.
    ollamaBase: process.env.MR_OLLAMA_HOST || "http://127.0.0.1:11434",
    ollamaModel: process.env.MR_BANNER_MODEL || "qwen3:8b",
    comfyBase: process.env.MR_COMFYUI_HOST || "http://127.0.0.1:8188",
    // Wall-clock cap on the whole banner stage. It has to cover ComfyUI still
    // booting (the run starts ~60 s after WOL; ComfyUI is listening ~2 min
    // after that), the prompt model's cold load, and a cold FLUX render
    // (~55 s measured). Past this the digest goes out without a banner. (ms)
    budgetMs: Number(process.env.MR_BANNER_BUDGET_MS || 8 * 60 * 1000),
  },
};
