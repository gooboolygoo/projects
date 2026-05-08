import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import "dotenv/config";

const ROOT = resolve(import.meta.dirname, "..");
const SITES_DIR = join(ROOT, "sites");
const POSTIZ_BASE = "https://api.postiz.com/public/v1";
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type PromoPlatformX = { tweet: string; reply_lead: string };
type Promo = {
  url: string;
  hashtags: string[];
  x: PromoPlatformX;
  vertical_caption: string;
  shorts_description_lead: string;
  video: { title: string; script: string; word_count: number };
};
type Meta = { title: string; blurb: string };

type Integration = {
  id: string;
  name: string;
  identifier: string;
  picture?: string;
  disabled?: boolean;
  profile?: string;
};

type Media = { id: string; path: string };

type PostMode = "draft" | "now" | "schedule";

type ComposedPost = {
  platform: "x" | "tiktok" | "instagram" | "facebook" | "youtube";
  postItem: unknown;
};

const TARGET_PLATFORMS = [
  "x",
  "tiktok",
  "instagram",
  "facebook",
  "youtube",
] as const;
type TargetPlatform = (typeof TARGET_PLATFORMS)[number];

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
  return JSON.parse(await readFile(promoPath, "utf8")) as Promo;
}

async function loadMeta(slug: string): Promise<Meta> {
  const raw = await readFile(join(SITES_DIR, slug, "meta.yml"), "utf8");
  const parsed = parseYaml(raw) as Partial<Meta> | null;
  if (!parsed?.title || !parsed?.blurb) {
    throw new Error(`sites/${slug}/meta.yml missing required title/blurb`);
  }
  return { title: parsed.title, blurb: parsed.blurb };
}

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: apiKey };
}

async function postizFetch<T>(
  apiKey: string,
  path: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${POSTIZ_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(apiKey), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Postiz ${init.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 400)}`,
    );
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Postiz ${path} returned non-JSON: ${text.slice(0, 200)}`,
    );
  }
}

async function listIntegrations(apiKey: string): Promise<Integration[]> {
  return postizFetch<Integration[]>(apiKey, "/integrations");
}

async function uploadVideo(apiKey: string, filePath: string): Promise<Media> {
  const stats = await stat(filePath);
  const fileName = basename(filePath);
  const stream = createReadStream(filePath);
  const buf = await new Promise<Buffer>((res, rej) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c) =>
      chunks.push(typeof c === "string" ? Buffer.from(c) : c),
    );
    stream.on("end", () => res(Buffer.concat(chunks)));
    stream.on("error", rej);
  });
  const blob = new Blob([new Uint8Array(buf)], { type: "video/mp4" });
  const form = new FormData();
  form.append("file", blob, fileName);
  console.log(
    `[post] uploading ${fileName} (${(stats.size / (1024 * 1024)).toFixed(1)} MB) to Postiz`,
  );
  return postizFetch<Media>(apiKey, "/upload", {
    method: "POST",
    body: form,
  });
}

function composeHashtagLine(hashtags: string[]): string {
  return hashtags.map((h) => `#${h}`).join(" ");
}

function composeStandardCaption(
  body: string,
  url: string,
  hashtags: string[],
): string {
  return `${body}\n\n${url}\n\n${composeHashtagLine(hashtags)}`;
}

function composeXPost(args: {
  integrationId: string;
  promo: Promo;
  media: Media;
}): unknown {
  const { promo, media, integrationId } = args;
  const replyContent = `${promo.x.reply_lead} ${promo.url}`.trim();
  return {
    integration: { id: integrationId },
    value: [
      { content: promo.x.tweet, image: [media] },
      { content: replyContent, image: [] },
    ],
    settings: {
      __type: "x",
      who_can_reply_post: "everyone",
      community: "",
      made_with_ai: false,
      paid_partnership: false,
    },
  };
}

function composeTikTokPost(args: {
  integrationId: string;
  promo: Promo;
  media: Media;
}): unknown {
  const { promo, media, integrationId } = args;
  const caption = composeStandardCaption(
    promo.vertical_caption,
    promo.url,
    promo.hashtags,
  );
  return {
    integration: { id: integrationId },
    value: [{ content: caption, image: [media] }],
    settings: {
      __type: "tiktok",
      privacy_level: "PUBLIC_TO_EVERYONE",
      duet: true,
      stitch: true,
      comment: true,
      autoAddMusic: "no",
      brand_content_toggle: false,
      brand_organic_toggle: false,
      video_made_with_ai: false,
      content_posting_method: "DIRECT_POST",
    },
  };
}

function composeInstagramPost(args: {
  integrationId: string;
  identifier: string;
  promo: Promo;
  media: Media;
}): unknown {
  const { promo, media, integrationId, identifier } = args;
  const caption = composeStandardCaption(
    promo.vertical_caption,
    promo.url,
    promo.hashtags,
  );
  return {
    integration: { id: integrationId },
    value: [{ content: caption, image: [media] }],
    settings: {
      __type: identifier,
      post_type: "post",
      is_trial_reel: false,
      collaborators: [],
    },
  };
}

function composeFacebookPost(args: {
  integrationId: string;
  promo: Promo;
  media: Media;
}): unknown {
  const { promo, media, integrationId } = args;
  const caption = composeStandardCaption(
    promo.vertical_caption,
    promo.url,
    promo.hashtags,
  );
  return {
    integration: { id: integrationId },
    value: [{ content: caption, image: [media] }],
    settings: {
      __type: "facebook",
    },
  };
}

function composeYouTubePost(args: {
  integrationId: string;
  promo: Promo;
  media: Media;
}): unknown {
  const { promo, media, integrationId } = args;
  const description = composeStandardCaption(
    promo.shorts_description_lead,
    promo.url,
    promo.hashtags,
  );
  const title = promo.video.title.slice(0, 100);
  return {
    integration: { id: integrationId },
    value: [{ content: description, image: [media] }],
    settings: {
      __type: "youtube",
      title,
      type: "public",
      selfDeclaredMadeForKids: "no",
      tags: promo.hashtags.map((h) => ({ value: h, label: h })),
    },
  };
}

function pickIntegration(
  integrations: Integration[],
  identifier: TargetPlatform | "instagram-standalone",
): Integration | undefined {
  return integrations.find(
    (i) => i.identifier === identifier && !i.disabled,
  );
}

async function compose(args: {
  promo: Promo;
  media: Media;
  integrations: Integration[];
  enabled: Set<TargetPlatform>;
}): Promise<{ posts: ComposedPost[]; missing: string[] }> {
  const { promo, media, integrations, enabled } = args;
  const posts: ComposedPost[] = [];
  const missing: string[] = [];

  if (enabled.has("x")) {
    const i = pickIntegration(integrations, "x");
    if (i) {
      posts.push({
        platform: "x",
        postItem: composeXPost({ integrationId: i.id, promo, media }),
      });
    } else {
      missing.push("x");
    }
  }

  if (enabled.has("tiktok")) {
    const i = pickIntegration(integrations, "tiktok");
    if (i) {
      posts.push({
        platform: "tiktok",
        postItem: composeTikTokPost({ integrationId: i.id, promo, media }),
      });
    } else {
      missing.push("tiktok");
    }
  }

  if (enabled.has("instagram")) {
    const standalone = pickIntegration(integrations, "instagram-standalone");
    const fbLinked = pickIntegration(integrations, "instagram");
    const i = standalone ?? fbLinked;
    if (i) {
      posts.push({
        platform: "instagram",
        postItem: composeInstagramPost({
          integrationId: i.id,
          identifier: i.identifier,
          promo,
          media,
        }),
      });
    } else {
      missing.push("instagram");
    }
  }

  if (enabled.has("facebook")) {
    const i = pickIntegration(integrations, "facebook");
    if (i) {
      posts.push({
        platform: "facebook",
        postItem: composeFacebookPost({ integrationId: i.id, promo, media }),
      });
    } else {
      missing.push("facebook");
    }
  }

  if (enabled.has("youtube")) {
    const i = pickIntegration(integrations, "youtube");
    if (i) {
      posts.push({
        platform: "youtube",
        postItem: composeYouTubePost({ integrationId: i.id, promo, media }),
      });
    } else {
      missing.push("youtube");
    }
  }

  return { posts, missing };
}

function buildCreatePostBody(args: {
  posts: ComposedPost[];
  mode: PostMode;
  date: string;
  tags: string[];
}): unknown {
  return {
    type: args.mode,
    date: args.date,
    shortLink: false,
    tags: args.tags.map((t) => ({ value: t, label: t })),
    posts: args.posts.map((p) => p.postItem),
  };
}

async function runForSlug(args: {
  slug: string;
  apiKey: string;
  mode: PostMode;
  scheduleAt: Date;
  enabled: Set<TargetPlatform>;
  dryRun: boolean;
}): Promise<void> {
  const { slug, apiKey, mode, scheduleAt, enabled, dryRun } = args;
  if (!SLUG_RE.test(slug)) throw new Error(`Invalid slug: ${slug}`);

  const promo = await loadPromo(slug);
  await loadMeta(slug);
  const mp4Path = join(SITES_DIR, slug, "promo.mp4");
  if (!(await exists(mp4Path))) {
    throw new Error(
      `sites/${slug}/promo.mp4 missing — run \`npm run video -- ${slug}\` first`,
    );
  }

  let integrations: Integration[];
  let media: Media;

  if (dryRun) {
    integrations = [...enabled].map((p) => ({
      id: `<dry-run-${p}-id>`,
      name: `<dry-run ${p}>`,
      identifier: p,
    }));
    media = {
      id: "<dry-run-media-id>",
      path: "https://uploads.postiz.com/<dry-run>.mp4",
    };
    console.log(`[post] DRY RUN — no API calls will be made`);
  } else {
    console.log(`[post] listing Postiz integrations`);
    integrations = await listIntegrations(apiKey);
    media = await uploadVideo(apiKey, mp4Path);
  }

  const { posts, missing } = await compose({
    promo,
    media,
    integrations,
    enabled,
  });

  if (missing.length > 0) {
    console.warn(
      `[post] ${missing.join(", ")} not connected on Postiz — skipping`,
    );
  }
  if (posts.length === 0) {
    throw new Error("No platforms available to post to.");
  }

  const body = buildCreatePostBody({
    posts,
    mode,
    date: scheduleAt.toISOString(),
    tags: [slug],
  });

  if (dryRun) {
    console.log("[post] composed payload:");
    console.log(JSON.stringify(body, null, 2));
    return;
  }

  console.log(
    `[post] creating ${mode} post (${posts.map((p) => p.platform).join(", ")}) at ${scheduleAt.toISOString()}`,
  );
  const result = await postizFetch<unknown>(apiKey, "/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const receipt = {
    posted_at: new Date().toISOString(),
    mode,
    scheduled_for: scheduleAt.toISOString(),
    platforms: posts.map((p) => p.platform),
    skipped: missing,
    media_id: media.id,
    response: result,
  };
  await writeFile(
    join(SITES_DIR, slug, "post.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(
    `[post] ${slug} → ${posts.length} platform(s) posted, receipt at sites/${slug}/post.json`,
  );
}

function parseScheduleArg(raw: string | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `--schedule "${raw}" is not a valid ISO date (try 2026-05-08T20:00:00Z)`,
    );
  }
  return d;
}

function parsePlatforms(raw: string | undefined): Set<TargetPlatform> {
  if (!raw) return new Set(TARGET_PLATFORMS);
  const out = new Set<TargetPlatform>();
  for (const tok of raw.split(",").map((s) => s.trim().toLowerCase())) {
    if (!tok) continue;
    if (
      tok === "x" ||
      tok === "tiktok" ||
      tok === "instagram" ||
      tok === "facebook" ||
      tok === "youtube"
    ) {
      out.add(tok);
    } else {
      throw new Error(
        `--platforms unknown value "${tok}" (allowed: x, tiktok, instagram, facebook, youtube)`,
      );
    }
  }
  if (out.size === 0) {
    throw new Error("--platforms produced an empty set");
  }
  return out;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      help: { type: "boolean", short: "h", default: false },
      "dry-run": { type: "boolean", default: false },
      now: { type: "boolean", default: false },
      schedule: { type: "string" },
      platforms: { type: "string" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage:
  npm run post -- <slug>
      Save a draft on Postiz (default). Open Postiz UI to review and publish.

  npm run post -- <slug> --now
      Publish immediately to all connected platforms.

  npm run post -- <slug> --schedule 2026-05-08T20:00:00Z
      Schedule for a specific UTC time.

  npm run post -- <slug> --dry-run
      Print the composed Postiz payload without making any API calls.

  npm run post -- <slug> --platforms x,tiktok
      Restrict to a subset of platforms (default: x,tiktok,instagram,facebook,youtube).

Requires POSTIZ_API_KEY in your environment or .env file (unless --dry-run).
`);
    return;
  }

  if (positionals.length !== 1) {
    throw new Error("Expected exactly one slug argument. See --help.");
  }
  const slug = positionals[0]!;

  const dryRun = !!values["dry-run"];
  let mode: PostMode = "draft";
  if (values.now && values.schedule) {
    throw new Error("--now and --schedule are mutually exclusive");
  }
  if (values.now) mode = "now";
  if (values.schedule) mode = "schedule";

  const scheduleAt = parseScheduleArg(values.schedule);
  const enabled = parsePlatforms(values.platforms);

  let apiKey = "";
  if (!dryRun) {
    apiKey = (process.env.POSTIZ_API_KEY ?? "").trim();
    if (!apiKey) {
      throw new Error(
        "POSTIZ_API_KEY is not set. Add it to .env or export it. (Or rerun with --dry-run.)",
      );
    }
  }

  await runForSlug({ slug, apiKey, mode, scheduleAt, enabled, dryRun });
}

main().catch((err) => {
  console.error("[post] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
