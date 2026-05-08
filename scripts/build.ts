import { readdir, readFile, writeFile, mkdir, cp, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const ROOT = resolve(import.meta.dirname, "..");
const SITES_DIR = join(ROOT, "sites");
const PUBLIC_DIR = join(ROOT, "public");
const SHARED_DIR = join(ROOT, "shared");
const DONATE_SNIPPET_PATH = join(SHARED_DIR, "donate-snippet.html");

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type Meta = {
  title: string;
  blurb: string;
  tags?: string[];
  donate?: boolean;
};

type Site = {
  slug: string;
  meta: Meta;
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function loadMeta(slug: string): Promise<Meta> {
  const metaPath = join(SITES_DIR, slug, "meta.yml");
  if (!(await exists(metaPath))) {
    throw new Error(`sites/${slug}/meta.yml is missing`);
  }
  const raw = await readFile(metaPath, "utf8");
  const parsed = parseYaml(raw) as Partial<Meta> | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`sites/${slug}/meta.yml is empty or invalid`);
  }
  if (!parsed.title || typeof parsed.title !== "string") {
    throw new Error(`sites/${slug}/meta.yml: 'title' (string) is required`);
  }
  if (!parsed.blurb || typeof parsed.blurb !== "string") {
    throw new Error(`sites/${slug}/meta.yml: 'blurb' (string) is required`);
  }
  return {
    title: parsed.title,
    blurb: parsed.blurb,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    donate: parsed.donate !== false,
  };
}

function injectDonate(html: string, snippet: string): string {
  if (html.includes("</body>")) {
    return html.replace("</body>", `${snippet}\n</body>`);
  }
  return `${html}\n${snippet}\n`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderIndexPage(sites: Site[]): string {
  const cards = sites
    .map(
      (s) => `      <a class="card" href="./${s.slug}/">
        <h2>${escapeHtml(s.meta.title)}</h2>
        <p>${escapeHtml(s.meta.blurb)}</p>
        ${
          s.meta.tags && s.meta.tags.length > 0
            ? `<div class="tags">${s.meta.tags
                .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
                .join("")}</div>`
            : ""
        }
      </a>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>gooboolygoo / projects</title>
  <meta name="description" content="A new tiny website every day." />
  <style>
    :root{color-scheme:light dark}
    *{box-sizing:border-box}
    body{
      margin:0;padding:3rem 1.25rem 6rem;
      font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
      background:Canvas;color:CanvasText;
    }
    main{max-width:960px;margin:0 auto}
    header{margin-bottom:2.5rem}
    h1{font-size:clamp(1.75rem,4vw,2.5rem);margin:0 0 .35rem}
    header p{margin:0;opacity:.75}
    .grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
    .card{
      display:block;padding:1.1rem 1.2rem;border-radius:14px;
      background:color-mix(in srgb,CanvasText 5%,Canvas);
      color:inherit;text-decoration:none;
      border:1px solid color-mix(in srgb,CanvasText 10%,transparent);
      transition:transform .15s ease,border-color .15s ease;
    }
    .card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,CanvasText 25%,transparent)}
    .card h2{margin:0 0 .35rem;font-size:1.1rem}
    .card p{margin:0;opacity:.8;font-size:.92rem}
    .tags{margin-top:.7rem;display:flex;flex-wrap:wrap;gap:.35rem}
    .tag{
      font-size:.72rem;padding:.15rem .5rem;border-radius:999px;
      background:color-mix(in srgb,CanvasText 10%,Canvas);
      opacity:.85;
    }
    .empty{opacity:.6;font-style:italic}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>projects</h1>
      <p>A new tiny website every day, by <a href="https://github.com/gooboolygoo">@gooboolygoo</a>.</p>
    </header>
    ${
      sites.length === 0
        ? `<p class="empty">No projects yet. Check back tomorrow.</p>`
        : `<div class="grid">\n${cards}\n    </div>`
    }
  </main>
</body>
</html>
`;
}

async function build(): Promise<void> {
  console.log("[build] root:", ROOT);

  if (!(await exists(SITES_DIR))) {
    throw new Error(`sites/ directory not found at ${SITES_DIR}`);
  }
  const donateSnippet = (await exists(DONATE_SNIPPET_PATH))
    ? await readFile(DONATE_SNIPPET_PATH, "utf8")
    : "";

  await rm(PUBLIC_DIR, { recursive: true, force: true });
  await mkdir(PUBLIC_DIR, { recursive: true });
  await writeFile(join(PUBLIC_DIR, ".nojekyll"), "");

  const entries = await readdir(SITES_DIR, { withFileTypes: true });
  const slugDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const seen = new Set<string>();
  const sites: Site[] = [];

  for (const slug of slugDirs) {
    if (!SLUG_RE.test(slug)) {
      throw new Error(
        `sites/${slug}: invalid slug. Must be lowercase kebab-case (a-z, 0-9, hyphens; no leading/trailing hyphen).`,
      );
    }
    if (seen.has(slug)) {
      throw new Error(`sites/${slug}: duplicate slug detected.`);
    }
    seen.add(slug);

    const meta = await loadMeta(slug);
    sites.push({ slug, meta });

    const src = join(SITES_DIR, slug);
    const dest = join(PUBLIC_DIR, slug);
    await cp(src, dest, {
      recursive: true,
      filter: (s) => {
        if (s.endsWith("meta.yml")) return false;
        if (s.endsWith("promo.json")) return false;
        if (s.endsWith("promo.mp4")) return false;
        if (s.endsWith("promo.mp3")) return false;
        if (s.includes("/.video-cache")) return false;
        return true;
      },
    });

    const indexPath = join(dest, "index.html");
    if (!(await exists(indexPath))) {
      throw new Error(`sites/${slug}/index.html is missing`);
    }
    if (meta.donate && donateSnippet) {
      const html = await readFile(indexPath, "utf8");
      await writeFile(indexPath, injectDonate(html, donateSnippet));
    }

    console.log(`[build] ✓ ${slug}  →  /projects/${slug}/`);
  }

  sites.sort((a, b) => a.meta.title.localeCompare(b.meta.title));
  await writeFile(join(PUBLIC_DIR, "index.html"), renderIndexPage(sites));

  console.log(`[build] wrote ${sites.length} site(s) + index.html to public/`);
}

build().catch((err) => {
  console.error("[build] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
