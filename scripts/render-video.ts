import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { synthesize } from "./video/tts.ts";
import { captureShots } from "./video/capture.ts";

const ROOT = resolve(import.meta.dirname, "..");
const SITES_DIR = join(ROOT, "sites");
const PUBLIC_DIR = join(ROOT, "public");
const REMOTION_ENTRY = join(ROOT, "remotion", "index.ts");
const SITE_BASE_URL = "https://gooboolygoo.github.io/projects";
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type Promo = {
  url: string;
  hashtags: string[];
  x: { tweet: string; reply_lead: string };
  vertical_caption: string;
  shorts_description_lead: string;
  video: { title: string; script: string; word_count: number };
};

type Meta = { title: string; blurb: string };

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function loadPromo(slug: string): Promise<Promo> {
  const promoPath = join(SITES_DIR, slug, "promo.json");
  if (!(await exists(promoPath))) {
    throw new Error(
      `sites/${slug}/promo.json missing — run \`npm run promo -- ${slug}\` first`,
    );
  }
  const raw = await readFile(promoPath, "utf8");
  return JSON.parse(raw) as Promo;
}

async function loadMeta(slug: string): Promise<Meta> {
  const raw = await readFile(join(SITES_DIR, slug, "meta.yml"), "utf8");
  const parsed = parseYaml(raw) as Partial<Meta> | null;
  if (!parsed?.title || !parsed?.blurb) {
    throw new Error(`sites/${slug}/meta.yml missing required title/blurb`);
  }
  return { title: parsed.title, blurb: parsed.blurb };
}

async function renderForSlug(args: {
  slug: string;
  source: "local" | "live";
}): Promise<{ outPath: string; durationMs: number }> {
  const { slug, source } = args;
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }

  const promo = await loadPromo(slug);
  const meta = await loadMeta(slug);
  const siteDir = join(SITES_DIR, slug);
  const cacheDir = join(siteDir, ".video-cache");
  await rm(cacheDir, { recursive: true, force: true });
  await mkdir(cacheDir, { recursive: true });

  console.log(`[video][${slug}] 1/4 generating voiceover via Edge TTS`);
  const audioPath = join(cacheDir, "audio.mp3");
  const tts = await synthesize({
    text: promo.video.script,
    outPath: audioPath,
  });
  console.log(
    `[video][${slug}]    ${tts.words.length} words, ${(tts.durationMs / 1000).toFixed(1)}s audio`,
  );

  console.log(`[video][${slug}] 2/4 capturing site screenshots`);
  let captureUrl: string;
  if (source === "live") {
    captureUrl = `${SITE_BASE_URL}/${slug}/`;
  } else {
    const localIndex = join(PUBLIC_DIR, slug, "index.html");
    if (!(await exists(localIndex))) {
      throw new Error(
        `Local source missing: ${localIndex}. Run \`npm run build\` first, or use --source live.`,
      );
    }
    captureUrl = `file://${localIndex}`;
  }
  const capture = await captureShots({
    url: captureUrl,
    outDir: cacheDir,
    count: 4,
  });
  console.log(
    `[video][${slug}]    captured ${capture.shots.length} shots from ${captureUrl}`,
  );

  console.log(`[video][${slug}] 3/4 bundling Remotion composition`);
  const bundled = await bundle({
    entryPoint: REMOTION_ENTRY,
    publicDir: cacheDir,
  });

  const inputProps = {
    title: meta.title,
    url: promo.url,
    words: tts.words,
    shotCount: capture.shots.length,
    voiceDurationMs: tts.durationMs,
  };

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "promo",
    inputProps,
  });

  console.log(
    `[video][${slug}] 4/4 rendering ${composition.durationInFrames} frames @ ${composition.fps}fps (${(composition.durationInFrames / composition.fps).toFixed(1)}s)`,
  );
  const outPath = join(siteDir, "promo.mp4");
  let lastReported = -1;
  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outPath,
    inputProps,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct !== lastReported && pct % 10 === 0) {
        process.stdout.write(`[video][${slug}]    ${pct}%\n`);
        lastReported = pct;
      }
    },
  });

  return {
    outPath,
    durationMs:
      (composition.durationInFrames / composition.fps) * 1000,
  };
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h", default: false },
      source: { type: "string", default: "local" },
      force: { type: "boolean", short: "f", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage:
  npm run video                 render every site missing promo.mp4
  npm run video -- <slug>       render one site
  npm run video -- <slug> -f    overwrite an existing promo.mp4
  npm run video -- <slug> --source live   capture from the deployed URL

Notes:
  --source local (default) reads from public/<slug>/index.html (run \`npm run build\` first).
  --source live  hits ${SITE_BASE_URL}/<slug>/ directly (use after Pages deploy).
`);
    return;
  }

  const source = (values.source as string) === "live" ? "live" : "local";

  let targets: string[] = [];
  if (positionals.length > 0) {
    targets = positionals;
  } else {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(SITES_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue;
      const out = join(SITES_DIR, e.name, "promo.mp4");
      if (values.force || !(await exists(out))) targets.push(e.name);
    }
    if (targets.length === 0) {
      console.log(
        "[video] every site already has promo.mp4. Pass -f to force-rerender.",
      );
      return;
    }
  }

  console.log(`[video] targets: ${targets.join(", ")} (source=${source})`);
  for (const slug of targets) {
    if (
      !values.force &&
      positionals.length === 0 &&
      (await exists(join(SITES_DIR, slug, "promo.mp4")))
    ) {
      continue;
    }
    const t0 = Date.now();
    try {
      const { outPath, durationMs } = await renderForSlug({ slug, source });
      console.log(
        `[video][${slug}] DONE ${(durationMs / 1000).toFixed(1)}s video → ${outPath}  (build ${(
          (Date.now() - t0) / 1000
        ).toFixed(1)}s)`,
      );
    } catch (err) {
      console.error(
        `[video][${slug}] FAILED:`,
        err instanceof Error ? err.message : err,
      );
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("[video] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
