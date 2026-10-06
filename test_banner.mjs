// Smoke test for the banner stage on the GPU box. Run from the project root:
//   node test_banner.mjs
// Writes output/banner-test.png and output/banner-test.html (a minimal page
// embedding the data URI, used to test the n8n inline-image email path).
import { writeFileSync, mkdirSync } from "node:fs";
import { getBannerDataUri } from "./src/banner.js";
import { config } from "./config.js";

const t0 = Date.now();
const uri = await getBannerDataUri({ ...config.banner, budgetMs: 6 * 60 * 1000 });
mkdirSync("output", { recursive: true });
writeFileSync("output/banner-test.png", Buffer.from(uri.split(",")[1], "base64"));
writeFileSync(
  "output/banner-test.html",
  `<!DOCTYPE html><html><body style="background:#0d1117;color:#c8c0b0;font-family:sans-serif">` +
    `<h2>Banner inline-image test</h2>` +
    `<img src="${uri}" alt="" style="width:100%;display:block">` +
    `<p>Rendered ${new Date().toISOString()}</p></body></html>\n`,
);
console.error(`banner test: OK in ${Math.round((Date.now() - t0) / 1000)} s, ${uri.length} chars`);
