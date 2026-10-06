// Curation step: hand the merged results to the agent and ask for a polished
// HTML body. Retries if the reply doesn't look like HTML; if it never does,
// falls back to a plain auto-generated listing so the digest still goes out.

import { runAgent } from "./agent.js";
import { coalesceText } from "./parse.js";
import { config } from "../config.js";
import { warn, sleep } from "./util.js";

// Reinforce "HTML only" on retries, mirroring the scraper's strict suffix.
// Without this, every retry re-sent the identical prompt and failed identically.
const STRICT_SUFFIX =
  "\n\nIMPORTANT: Return ONLY the raw HTML fragment. Your reply must start with '<' — no prose, no explanation, no markdown, no code fences.";

function buildPrompt(results, attempt) {
  const template =
    attempt === 1
      ? config.curation.promptTemplate
      : config.curation.promptTemplate + STRICT_SUFFIX;
  return template.replace("{{RESULTS}}", JSON.stringify(results));
}

function looksLikeHtml(s) {
  return /<h2|<li|<a\s|<p[>\s]/i.test(s);
}

// Keep only the markup. Even with the event stream filtered down to assistant
// text, a model that has been told "HTML only" still likes to open with a line
// of preamble or close with a summary, and that prose would be rendered as the
// first thing in the email. Everything outside the outermost <...> goes.
function clampToMarkup(s) {
  const start = s.indexOf("<");
  const end = s.lastIndexOf(">");
  if (start === -1 || end === -1 || end < start) return s;
  return s.slice(start, end + 1);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// If curation fails entirely, render the raw results ourselves so the email is
// still useful. Each results entry is a single-key object: { label: items }.
function fallbackHtml(results) {
  const sections = results.map((entry) => {
    const [label, items] = Object.entries(entry)[0];
    const lis = (items || [])
      .slice(0, 5)
      .map((item) => {
        const title = item.event || item.project || item.title || "Untitled";
        const summary = item.description || item.date || "";
        const url = item.url || "#";
        return (
          `    <li><a href="${escapeHtml(url)}">${escapeHtml(title)}</a>` +
          (summary ? `<p>${escapeHtml(summary)}</p>` : "") +
          `</li>`
        );
      })
      .join("\n");
    return `<h2>${escapeHtml(label)}</h2>\n<ul>\n${lis}\n</ul>`;
  });
  return sections.join("\n");
}

export async function curate(results) {
  const { maxAttempts, backoffMs } = config.retries;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Same early exit as the scrapers: once the fragment is there, the
      // session has nothing left to contribute.
      const raw = await runAgent(buildPrompt(results, attempt), {
        isComplete: (text) => looksLikeHtml(coalesceText(text)),
      });
      let html = coalesceText(raw).trim();

      // Strip a stray ```html ... ``` fence if the model added one.
      const fence = html.match(/```(?:html)?\s*([\s\S]*?)```/i);
      if (fence) html = fence[1].trim();

      if (looksLikeHtml(html)) {
        return clampToMarkup(html).trim();
      }
      warn(`[curation] attempt ${attempt}/${maxAttempts} did not return HTML`);
      // Diagnostics only (MR_DEBUG=true). Never logged in production, so no
      // response content is recorded once this is live.
      if (config.debug) {
        warn(`[curation] raw reply (first 500 chars): ${html.slice(0, 500)}`);
      }
    } catch (err) {
      warn(`[curation] attempt ${attempt}/${maxAttempts} error: ${err.message}`);
    }

    if (attempt < maxAttempts) await sleep(backoffMs * attempt);
  }

  warn("[curation] falling back to auto-generated HTML from raw results");
  return fallbackHtml(results);
}
