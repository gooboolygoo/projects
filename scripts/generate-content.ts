import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";
import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = resolve(import.meta.dirname, "..");
const SITES_DIR = join(ROOT, "sites");
const SITE_BASE_URL = "https://gooboolygoo.github.io/projects";
const AUTHOR_HANDLE = "gooboolygoo";
const MODEL = "claude-haiku-4-5";
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type Meta = {
  title: string;
  blurb: string;
  tags?: string[];
  donate?: boolean;
};

type Promo = {
  generated_at: string;
  model: string;
  url: string;
  hashtags: string[];
  x: {
    tweet: string;
    reply_lead: string;
  };
  vertical_caption: string;
  shorts_description_lead: string;
  video: {
    title: string;
    script: string;
    word_count: number;
  };
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
  const raw = await readFile(join(SITES_DIR, slug, "meta.yml"), "utf8");
  const parsed = parseYaml(raw) as Partial<Meta> | null;
  if (!parsed?.title || !parsed?.blurb) {
    throw new Error(`sites/${slug}/meta.yml missing required title/blurb`);
  }
  return {
    title: parsed.title,
    blurb: parsed.blurb,
    tags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
    donate: parsed.donate !== false,
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const SYSTEM_PROMPT = `You are the social-media editor for a series of tiny self-contained websites by @${AUTHOR_HANDLE} on GitHub.

Each project is its own thing. Your job is to draft promotional copy for ONE project at a time across X, TikTok, Instagram Reels, and YouTube Shorts.

Voice: conversational, curious, a little playful. No corporate hype, no "revolutionary", no excessive emoji. At most one emoji per individual field. Write like a developer talking to other developers and curious humans, not a marketer.

CRITICAL RULES:
- Each project stands on its own. Never reference a sequence, schedule, or day number. NEVER write "Day 1", "day one", "first project", "today's project", "tomorrow", "the daily series", "every day", "ships daily", or anything that frames this project as part of a numbered or scheduled rollout. The audience does not know or care which day it is. Pretend this is the only project in the world.
- Never include URLs anywhere in your output. The pipeline appends the URL itself.
- Never include hashtags inline in any text. Hashtags go in the dedicated "hashtags" field only.
- Never use the author's handle ("${AUTHOR_HANDLE}") as a hashtag — personal handles get no community reach.

Return everything via the publish_promo tool. Do not write anything else.`;

const USER_PROMPT_TEMPLATE = (args: {
  slug: string;
  url: string;
  meta: Meta;
  pageText: string;
}) => `Project slug: ${args.slug}
Live URL (for your context only — DO NOT echo into output): ${args.url}
Title: ${args.meta.title}
Author's blurb: ${args.meta.blurb}
Tags: ${args.meta.tags?.join(", ") || "(none)"}

Rendered text content of the page (HTML stripped):
"""
${args.pageText.slice(0, 4000)}
"""

Draft promotional copy for this project. The pipeline will compose the final per-platform posts by stitching your copy with the URL and hashtags in the right place for each platform — so KEEP YOUR FIELDS CLEAN OF URLS AND HASHTAGS.

Field-by-field guidance:

x.tweet
  The main post body on X. Max 240 characters. At most one emoji. No URL.
  No hashtags. Hook the reader; the URL goes in a separate first-reply.

x.reply_lead
  Short phrase, max 80 characters, that will be followed by the URL in
  the first-reply tweet. Examples: "live here →", "try it yourself ↓",
  "build is up". No URL, no hashtags. No trailing punctuation.

vertical_caption
  Caption body for TikTok AND Instagram Reels (the same text is used for both).
  Max 220 characters. Hook in first sentence — viewers see only the first
  line before "more". At most one emoji. No URL, no hashtags.

shorts_description_lead
  1-2 sentence description for YouTube Shorts. Max 220 characters.
  Slightly more polished than vertical_caption. No URL, no hashtags.

hashtags
  3 to 5 lowercase hashtag tokens WITHOUT the leading '#'. Mix one or two
  specific to the project with one or two general (e.g. "buildinpublic",
  "100daysofcode", "indiedev", "webdev"). NEVER include "${AUTHOR_HANDLE}"
  or any personal handle.

video.title
  Punchy 4-8 word title used for YouTube Shorts and as the TikTok working
  title. Title Case, no clickbait, no emoji.

video.script
  Voiceover script for a 30-second vertical video. Target 75-85 words for
  pacing. Open with a hook in the first 2 seconds. End with a soft CTA
  (e.g. "link in the description" or "tap the link"). Plain prose. No
  emoji. No stage directions. No section markers.

Return everything via the publish_promo tool now.`;

const TOOL_SCHEMA = {
  name: "publish_promo",
  description:
    "Submit the final promotional copy for the project. Call this exactly once.",
  input_schema: {
    type: "object",
    properties: {
      x: {
        type: "object",
        properties: {
          tweet: { type: "string" },
          reply_lead: { type: "string" },
        },
        required: ["tweet", "reply_lead"],
      },
      vertical_caption: { type: "string" },
      shorts_description_lead: { type: "string" },
      hashtags: {
        type: "array",
        minItems: 3,
        maxItems: 5,
        items: { type: "string", pattern: "^[a-z0-9]+$" },
      },
      video: {
        type: "object",
        properties: {
          title: { type: "string" },
          script: { type: "string" },
        },
        required: ["title", "script"],
      },
    },
    required: [
      "x",
      "vertical_caption",
      "shorts_description_lead",
      "hashtags",
      "video",
    ],
  },
} as const;

type ToolInput = {
  x: { tweet: string; reply_lead: string };
  vertical_caption: string;
  shorts_description_lead: string;
  hashtags: string[];
  video: { title: string; script: string };
};

const URL_RE = /\bhttps?:\/\/\S+/i;

function assertNoUrl(field: string, value: string): void {
  if (URL_RE.test(value)) {
    throw new Error(`tool input: ${field} must not contain a URL`);
  }
}

function assertNoInlineHashtag(field: string, value: string): void {
  if (/(?:^|\s)#[A-Za-z0-9]/.test(value)) {
    throw new Error(`tool input: ${field} must not contain inline hashtags`);
  }
}

function assertMaxLen(field: string, value: string, max: number): void {
  if (value.length > max) {
    throw new Error(`tool input: ${field} is ${value.length} chars (max ${max})`);
  }
}

function validateToolInput(raw: unknown): ToolInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Claude returned a non-object tool input.");
  }
  const r = raw as Record<string, unknown>;
  const x = r.x as Record<string, unknown> | undefined;
  if (!x || typeof x.tweet !== "string" || typeof x.reply_lead !== "string") {
    throw new Error("tool input: x.tweet and x.reply_lead are required");
  }
  const vertical_caption = r.vertical_caption;
  const shorts_description_lead = r.shorts_description_lead;
  const hashtags = r.hashtags;
  const video = r.video as Record<string, unknown> | undefined;
  if (typeof vertical_caption !== "string" || vertical_caption.length === 0) {
    throw new Error("tool input: vertical_caption required");
  }
  if (
    typeof shorts_description_lead !== "string" ||
    shorts_description_lead.length === 0
  ) {
    throw new Error("tool input: shorts_description_lead required");
  }
  if (!Array.isArray(hashtags) || hashtags.length < 3 || hashtags.length > 5) {
    throw new Error("tool input: hashtags must be an array of 3-5 strings");
  }
  if (!hashtags.every((h) => typeof h === "string" && /^[a-z0-9]+$/.test(h))) {
    throw new Error(
      "tool input: each hashtag must be lowercase a-z/0-9 only, no '#'",
    );
  }
  if (
    hashtags.some((h) => h.toLowerCase() === AUTHOR_HANDLE.toLowerCase())
  ) {
    throw new Error(
      `tool input: hashtags must not include the author handle "${AUTHOR_HANDLE}"`,
    );
  }
  if (
    !video ||
    typeof video.title !== "string" ||
    typeof video.script !== "string"
  ) {
    throw new Error("tool input: video.title and video.script are required");
  }

  assertMaxLen("x.tweet", x.tweet as string, 260);
  assertMaxLen("x.reply_lead", x.reply_lead as string, 100);
  assertMaxLen("vertical_caption", vertical_caption, 240);
  assertMaxLen("shorts_description_lead", shorts_description_lead, 240);

  for (const [name, value] of [
    ["x.tweet", x.tweet as string],
    ["x.reply_lead", x.reply_lead as string],
    ["vertical_caption", vertical_caption],
    ["shorts_description_lead", shorts_description_lead],
    ["video.script", video.script as string],
  ] as [string, string][]) {
    assertNoUrl(name, value);
    assertNoInlineHashtag(name, value);
  }

  return {
    x: { tweet: x.tweet as string, reply_lead: x.reply_lead as string },
    vertical_caption,
    shorts_description_lead,
    hashtags: hashtags as string[],
    video: { title: video.title, script: video.script },
  };
}

async function callClaudeOnce(args: {
  client: Anthropic;
  slug: string;
  url: string;
  meta: Meta;
  pageText: string;
}): Promise<{ data: ToolInput; stopReason: string | null }> {
  const { client, slug, url, meta, pageText } = args;
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    tools: [TOOL_SCHEMA as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "publish_promo" },
    messages: [
      {
        role: "user",
        content: USER_PROMPT_TEMPLATE({ slug, url, meta, pageText }),
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `Claude did not return a tool_use block. stop_reason=${response.stop_reason}`,
    );
  }
  const data = validateToolInput(toolUse.input);
  return { data, stopReason: response.stop_reason };
}

async function generatePromo(slug: string, client: Anthropic): Promise<Promo> {
  if (!SLUG_RE.test(slug)) {
    throw new Error(`Invalid slug: ${slug}`);
  }
  const meta = await loadMeta(slug);
  const html = await readFile(join(SITES_DIR, slug, "index.html"), "utf8");
  const pageText = htmlToText(html);
  const url = `${SITE_BASE_URL}/${slug}/`;

  let data: ToolInput;
  try {
    ({ data } = await callClaudeOnce({ client, slug, url, meta, pageText }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  [retry] first attempt failed: ${msg}`);
    ({ data } = await callClaudeOnce({ client, slug, url, meta, pageText }));
  }
  const wordCount = data.video.script.trim().split(/\s+/).length;

  return {
    generated_at: new Date().toISOString(),
    model: MODEL,
    url,
    hashtags: data.hashtags,
    x: data.x,
    vertical_caption: data.vertical_caption,
    shorts_description_lead: data.shorts_description_lead,
    video: {
      title: data.video.title,
      script: data.video.script,
      word_count: wordCount,
    },
  };
}

async function listSlugs(): Promise<string[]> {
  const entries = await readdir(SITES_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && SLUG_RE.test(e.name))
    .map((e) => e.name)
    .sort();
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      force: { type: "boolean", short: "f", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`Usage:
  npm run promo                  generate promo.json for every site missing one
  npm run promo -- <slug>        generate promo.json for one site
  npm run promo -- <slug> -f     overwrite an existing promo.json

Requires ANTHROPIC_API_KEY in your environment or .env file.
`);
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example) or export it.",
    );
  }
  if (
    !apiKey.startsWith("sk-ant-") ||
    apiKey.length < 40 ||
    /[^A-Za-z0-9_\-]/.test(apiKey)
  ) {
    throw new Error(
      "ANTHROPIC_API_KEY looks like a placeholder (e.g. 'sk-ant-...'). Paste your real key from https://console.anthropic.com/settings/keys into .env",
    );
  }
  const client = new Anthropic({ apiKey });

  const allSlugs = await listSlugs();
  let targets: string[];
  if (positionals.length > 0) {
    targets = positionals;
    for (const t of targets) {
      if (!allSlugs.includes(t)) {
        throw new Error(`No site found at sites/${t}/`);
      }
    }
  } else {
    targets = [];
    for (const slug of allSlugs) {
      const promoPath = join(SITES_DIR, slug, "promo.json");
      if (values.force || !(await exists(promoPath))) {
        targets.push(slug);
      }
    }
    if (targets.length === 0) {
      console.log(
        "[promo] every site already has a promo.json. Pass -f to force-regenerate.",
      );
      return;
    }
  }

  console.log(`[promo] generating for: ${targets.join(", ")}`);
  for (const slug of targets) {
    const promoPath = join(SITES_DIR, slug, "promo.json");
    if (
      !values.force &&
      (await exists(promoPath)) &&
      positionals.length === 0
    ) {
      continue;
    }
    process.stdout.write(`[promo] ${slug} ... `);
    try {
      const promo = await generatePromo(slug, client);
      await writeFile(promoPath, JSON.stringify(promo, null, 2) + "\n");
      console.log(
        `ok (x ${promo.x.tweet.length}c, vert ${promo.vertical_caption.length}c, script ${promo.video.word_count}w)`,
      );
    } catch (err) {
      console.log("FAILED");
      console.error(`  ${err instanceof Error ? err.message : err}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error("[promo] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
