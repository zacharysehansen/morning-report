# Quick smoke test: runs banner.js in isolation on Windows.
# Usage: powershell -File test_banner.ps1
# Checks syntax loads and makes the ComfyUI + Ollama calls.
# Output: banner_test.png in the project root if successful.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

$testScript = @'
import { getBannerDataUri } from "./src/banner.js";

const config = {
  ollamaBase: "http://localhost:11434",
  ollamaModel: "qwen3:8b",
  comfyBase: "http://localhost:8188",
};

console.error("Starting banner test...");
const dataUri = await getBannerDataUri(config);
const b64 = dataUri.replace(/^data:image\/png;base64,/, "");
import { writeFileSync } from "node:fs";
writeFileSync("banner_test.png", Buffer.from(b64, "base64"));
console.error("Done. Wrote banner_test.png");
console.log("OK");
'@

$testScript | node --input-type=module
exit $LASTEXITCODE
