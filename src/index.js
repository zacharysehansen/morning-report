#!/usr/bin/env node
// Morning Report — end-to-end orchestrator.
//
//   1. Scrape every source (concurrently, each with retry + validation).
//   2. Merge the survivors into { label: items } entries.
//   3. Curate into an HTML body (with retry + fallback).
//   4. Compose the styled email and emit it.
//
// Clean HTML is written to stdout; all logs go to stderr, so:
//   node src/index.js > digest.html

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sources } from "../sources.js";
import { config } from "../config.js";
import { scrapeSource } from "./scrape.js";
import { curate } from "./curate.js";
import { composeEmail } from "./template.js";
import { getBannerDataUri } from "./banner.js";
import { warn, error, mapWithConcurrency } from "./util.js";

// Emitted when every source failed. Returning nothing on stdout is what makes
// n8n send a completely empty email — a blank message gives no clue that the
// pipeline broke, so say so in the body and still exit non-zero.
function failureNotice() {
  return (
    `<h2>No digest today</h2>\n` +
    `<ul>\n  <li><a href="#">Every source failed</a>` +
    `<p>All ${sources.length} sources were skipped after ${config.retries.maxAttempts} ` +
    `attempts each. Check the stderr log from run.ps1 for the per-source reason.</p></li>\n</ul>`
  );
}

async function main() {
  // The banner renders BEFORE the scrapers start, not alongside them. Both
  // want the same 24 GB card: FLUX needs ~16 GB and the scrapers' 27B model
  // ~21 GB, so running them in parallel leaves one of them paging through
  // system RAM and the render times out. Sequential costs two or three
  // minutes on a run that takes fifteen; banner.js frees its VRAM when done.
  let bannerDataUri = null;
  if (config.banner.enabled) {
    bannerDataUri = await getBannerDataUri(config.banner).catch((err) => {
      warn(`banner skipped: ${err.message}`);
      return null;
    });
  }

  const scraped = await mapWithConcurrency(
    sources,
    config.concurrency,
    scrapeSource,
  );
  const survivors = scraped.filter(Boolean);

  let contentHtml;
  if (survivors.length === 0) {
    error("no sources returned usable data — emitting a failure notice");
    process.exitCode = 1;
    contentHtml = failureNotice();
  } else {
    if (survivors.length < sources.length) {
      warn(`${sources.length - survivors.length} source(s) skipped; continuing with ${survivors.length}`);
    }
    // Merge into the shape the curation prompt expects: [{ label: items }, ...]
    const results = survivors.map((s) => ({ [s.label]: s.items }));
    contentHtml = await curate(results);
  }

  const html = composeEmail(contentHtml, bannerDataUri);

  // Wait for the bytes to actually reach the OS. stdout is a pipe under n8n,
  // so the write is asynchronous, and the explicit process.exit() below would
  // otherwise be free to truncate the digest mid-document.
  await new Promise((resolve) => process.stdout.write(html + "\n", resolve));

  // Only a real digest earns a dated file; the failure notice would otherwise
  // overwrite a good digest from an earlier run on the same day.
  if (config.output.writeFile && survivors.length > 0) {
    const stamp = new Date().toISOString().slice(0, 10);
    mkdirSync(config.output.dir, { recursive: true });
    const file = join(config.output.dir, `digest-${stamp}.html`);
    writeFileSync(file, html, "utf8");
  }
}

main()
  .catch((err) => {
    error(`fatal: ${err.stack || err.message}`);
    process.exitCode = 1;
  })
  // Exit deliberately rather than waiting for the event loop to drain. The
  // digest is already flushed to stdout by this point, and anything opencode
  // left running behind our backs must not be able to keep the process — and
  // with it the n8n execution's ssh channel — alive indefinitely.
  .finally(() => process.exit(process.exitCode ?? 0));
