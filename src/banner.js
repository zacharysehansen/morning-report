// Generates a daily ComfyUI banner image using FLUX.1-dev fp8.
//
// Flow: wait for ComfyUI to answer → Ollama writes a themed image prompt →
// ComfyUI renders it → the PNG comes back as a base64 data URI → ComfyUI is
// told to drop its models so the VRAM is free for the scrapers.
//
// Every failure throws; index.js catches, logs, and sends the email without a
// banner. Nothing here may block the digest indefinitely, so every stage is
// bounded by the shared deadline passed in from index.js.

import { warn, sleep } from "./util.js";

const THEMES = [
  "vast alien landscape",
  "abstract light and geometry",
  "fog-shrouded mountain pass",
  "bioluminescent deep ocean",
  "crumbling brutalist architecture",
  "aurora borealis over tundra",
  "ancient forest at golden hour",
  "orbital view of a stormy planet",
  "desert dunes at blue hour",
  "neon-lit rain-soaked city street",
  "terraced rice fields at sunrise",
  "cosmic nebula and stellar nursery",
  "frozen lake in winter silence",
  "volcanic eruption at night",
  "minimalist Japanese garden in mist",
];

function dailySeed(date) {
  return Math.floor(date.getTime() / 86_400_000);
}

// Milliseconds left before `deadline`, floored at 1 s so a fetch always gets a
// real (if hopeless) timeout rather than 0.
function remaining(deadline) {
  return Math.max(1_000, deadline - Date.now());
}

// The digest runs about a minute after the box is woken by WOL, and ComfyUI's
// own start-up (custom-node imports) takes a couple of minutes after boot, so
// the first request of the day normally lands before it is listening. Poll
// until it answers instead of failing on the first refused connection.
async function waitForComfy(comfyBase, deadline) {
  let attempts = 0;
  for (;;) {
    try {
      const res = await fetch(`${comfyBase}/system_stats`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        if (attempts) warn(`banner: ComfyUI up after ${attempts * 5} s`);
        return;
      }
    } catch {
      // not listening yet
    }
    if (Date.now() >= deadline) {
      throw new Error(`ComfyUI at ${comfyBase} never came up within the banner budget`);
    }
    if (attempts++ % 6 === 0) warn("banner: waiting for ComfyUI...");
    await sleep(5_000);
  }
}

async function generatePrompt(date, ollamaBase, model, deadline) {
  const seed = dailySeed(date);
  const theme = THEMES[seed % THEMES.length];
  const dateStr = date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const body = JSON.stringify({
    model,
    prompt:
      `Today is ${dateStr}. Theme: ${theme}. ` +
      `Write a single image generation prompt for a wide cinematic banner. ` +
      `It will appear at the top of a dark-themed daily email. ` +
      `Emphasize mood, lighting, atmosphere, and visual style. ` +
      `No people. Return only the prompt, nothing else.`,
    stream: false,
    // No thinking phase: a one-line prompt doesn't need it and it would eat
    // most of the timeout on a cold model.
    think: false,
    // Evict this model the moment it answers. FLUX needs ~16 GB and the
    // scrapers' 27B model ~21 GB; a 5 GB prompt model left resident for the
    // default five minutes would push one of them into partial loads.
    keep_alive: 0,
    options: { temperature: 0.9, seed },
  });

  const res = await fetch(`${ollamaBase}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(Math.min(120_000, remaining(deadline))),
  });

  if (!res.ok) throw new Error(`Ollama /api/generate returned ${res.status}`);
  const json = await res.json();
  const text = (json.response ?? "").trim().replace(/^["']|["']$/g, "");
  if (!text) throw new Error("Ollama returned an empty prompt");
  return text;
}

function buildWorkflow(prompt, seed) {
  return {
    "1": {
      class_type: "UNETLoader",
      inputs: { unet_name: "flux1-dev-fp8.safetensors", weight_dtype: "fp8_e4m3fn" },
    },
    "2": {
      class_type: "DualCLIPLoader",
      inputs: {
        clip_name1: "clip_l.safetensors",
        clip_name2: "t5xxl_fp8_e4m3fn.safetensors",
        type: "flux",
      },
    },
    "3": {
      class_type: "VAELoader",
      inputs: { vae_name: "ae.safetensors" },
    },
    "4": {
      class_type: "CLIPTextEncodeFlux",
      inputs: { clip: ["2", 0], clip_l: prompt, t5xxl: prompt, guidance: 3.5 },
    },
    // Empty negative
    "5": {
      class_type: "CLIPTextEncode",
      inputs: { text: "", clip: ["2", 0] },
    },
    // Wide banner: 1216x320, both divisible by 64
    "6": {
      class_type: "EmptySD3LatentImage",
      inputs: { width: 1216, height: 320, batch_size: 1 },
    },
    "7": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["4", 0],
        negative: ["5", 0],
        latent_image: ["6", 0],
        sampler_name: "euler",
        scheduler: "beta",
        steps: 20,
        cfg: 1.0,
        denoise: 1.0,
        seed,
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: { samples: ["7", 0], vae: ["3", 0] },
    },
    "9": {
      class_type: "SaveImage",
      inputs: { images: ["8", 0], filename_prefix: "digest_banner" },
    },
  };
}

async function submitJob(comfyBase, workflow) {
  const res = await fetch(`${comfyBase}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ComfyUI /prompt returned ${res.status}`);
  const json = await res.json();
  if (!json.prompt_id) throw new Error("ComfyUI returned no prompt_id");
  return json.prompt_id;
}

async function pollForImage(comfyBase, promptId, deadline) {
  while (Date.now() < deadline) {
    await sleep(2_000);
    let history;
    try {
      const res = await fetch(`${comfyBase}/history/${promptId}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) continue;
      history = await res.json();
    } catch {
      continue;
    }
    const entry = history[promptId];
    if (!entry) continue;
    // Fail fast on a broken job (missing model file, OOM) instead of polling
    // out the whole budget.
    if (entry.status?.status_str === "error") {
      const err = (entry.status.messages ?? []).find((m) => m[0] === "execution_error");
      const detail = err?.[1]?.exception_message ?? "unknown error";
      throw new Error(`ComfyUI job failed: ${String(detail).slice(0, 200)}`);
    }
    const images = entry.outputs?.["9"]?.images;
    if (images?.length > 0) return images[0];
  }
  throw new Error("ComfyUI render exceeded the banner budget");
}

async function fetchImageAsDataUri(comfyBase, { filename, subfolder, type }) {
  const url =
    `${comfyBase}/view` +
    `?filename=${encodeURIComponent(filename)}` +
    `&subfolder=${encodeURIComponent(subfolder ?? "")}` +
    `&type=${encodeURIComponent(type ?? "output")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`ComfyUI /view returned ${res.status}`);
  const buf = await res.arrayBuffer();
  return `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
}

// ComfyUI keeps FLUX (~16 GB) resident after a render. The scrapers' 27B model
// is loaded right after this and needs most of the card, so hand it back.
async function freeComfy(comfyBase) {
  try {
    await fetch(`${comfyBase}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    warn(`banner: could not free ComfyUI VRAM: ${err.message}`);
  }
}

// `budgetMs` bounds the whole thing: waiting for ComfyUI, the prompt, and the
// render. Runs before the scrapers so the render has the GPU to itself.
export async function getBannerDataUri(bannerConfig) {
  const { ollamaBase, ollamaModel, comfyBase, budgetMs = 8 * 60 * 1000 } = bannerConfig;
  const deadline = Date.now() + budgetMs;
  const date = new Date();
  const seed = dailySeed(date);

  await waitForComfy(comfyBase, deadline);

  const prompt = await generatePrompt(date, ollamaBase, ollamaModel, deadline);
  warn(`banner: prompt="${prompt.slice(0, 80)}..."`);

  const workflow = buildWorkflow(prompt, seed);
  const promptId = await submitJob(comfyBase, workflow);
  warn(`banner: job submitted promptId=${promptId}`);

  try {
    const started = Date.now();
    const imageInfo = await pollForImage(comfyBase, promptId, deadline);
    warn(`banner: rendered filename=${imageInfo.filename} in ${Math.round((Date.now() - started) / 1000)} s`);
    return await fetchImageAsDataUri(comfyBase, imageInfo);
  } finally {
    await freeComfy(comfyBase);
  }
}
