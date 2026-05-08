import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SITES_DIR = join(ROOT, "sites");
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const entries = await readdir(SITES_DIR, { withFileTypes: true });
  const pending: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!SLUG_RE.test(e.name)) continue;
    const slugDir = join(SITES_DIR, e.name);
    const hasIndex = await exists(join(slugDir, "index.html"));
    const hasMeta = await exists(join(slugDir, "meta.yml"));
    if (!hasIndex || !hasMeta) continue;
    const alreadyPosted = await exists(join(slugDir, "post.json"));
    if (alreadyPosted) continue;
    pending.push(e.name);
  }
  pending.sort();
  for (const slug of pending) {
    process.stdout.write(`${slug}\n`);
  }
}

main().catch((err) => {
  console.error("[find-pending] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
