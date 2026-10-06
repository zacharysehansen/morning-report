// Scrape one source: call the agent, parse+validate its JSON, and retry with a
// stricter instruction if it misbehaves. After maxAttempts the source is
// skipped (returns null) so the rest of the digest can still be produced.

import { runAgent } from "./agent.js";
import { extractJson, coalesceText } from "./parse.js";
import { validateItems } from "./validate.js";
import { config } from "../config.js";
import { warn, sleep } from "./util.js";

const STRICT_SUFFIX =
  "\n\nIMPORTANT: Return ONLY a valid JSON array — no prose, no explanation, no markdown code fences. Your reply must start with '[' and end with ']'.";

export async function scrapeSource(source) {
  const { maxAttempts, backoffMs } = config.retries;
  let lastReason = "unknown error";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Reinforce the "JSON only" instruction on every retry.
    const prompt = attempt === 1 ? source.prompt : source.prompt + STRICT_SUFFIX;

    try {
      // Stop the moment the reply already contains an array that satisfies
      // this source's schema — that is the whole answer, and everything the
      // agent does after emitting it is wasted wall-clock.
      const raw = await runAgent(prompt, {
        isComplete: (text) => {
          const parsed = extractJson(text);
          return parsed !== undefined && validateItems(parsed, source.requiredKeys).ok;
        },
      });
      const data = extractJson(raw);
      if (data === undefined) {
        lastReason = "no JSON could be parsed from the output";
        // Diagnostics only (MR_DEBUG=true), matching curate.js. Without this
        // a parse failure gives you no way to tell a refusal from a truncated
        // reply from an agent that never ran. Log what the model actually
        // said, not the event envelope — 500 characters of raw stream is all
        // step markers and IDs.
        if (config.debug) {
          const said = coalesceText(raw).trim();
          warn(
            `[${source.label}] model said (first 600 chars): ${
              said.slice(0, 600) || "(nothing)"
            }`,
          );
        }
      } else {
        const result = validateItems(data, source.requiredKeys);
        if (result.ok) {
          return { label: source.label, items: data };
        }
        lastReason = result.reason;
      }
    } catch (err) {
      lastReason = err.message;
    }

    warn(`[${source.label}] attempt ${attempt}/${maxAttempts} failed: ${lastReason}`);
    if (attempt < maxAttempts) await sleep(backoffMs * attempt);
  }

  warn(`[${source.label}] skipped after ${maxAttempts} attempts. Last reason: ${lastReason}`);
  return null;
}
