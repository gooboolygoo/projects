/* Cloudflare Worker that proxies POST requests from the static Throughline
 * site to Anthropic's API. Keeps the API key server-side. CORS-locked to
 * the gooboolygoo.github.io origin (plus localhost for dev). */

const ALLOWED_ORIGINS = [
  "https://gooboolygoo.github.io",
  "https://whatshouldidowithmylife.xyz",
  "https://www.whatshouldidowithmylife.xyz",
  "http://localhost:8000",
  "http://localhost:3000",
  "http://localhost:5173",
];

// Vercel preview URLs have unpredictable subdomains
// (e.g. throughline-abc123-gooboolygoo.vercel.app). Allow the user's
// own vercel preview deployments without opening it up to every
// vercel.app site.
const VERCEL_PREVIEW_RE = /^https:\/\/throughline(-[\w-]+)?\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (VERCEL_PREVIEW_RE.test(origin)) return true;
  return false;
}

const MAX_TOKENS_CAP = 4000;
const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-6",
  "claude-sonnet-4-7",
  "claude-haiku-4-5",
]);

function corsHeaders(origin) {
  const allow = isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers });
    }
    if (!isAllowedOrigin(origin)) {
      return new Response("Forbidden", { status: 403, headers });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured on the worker" }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400, headers });
    }

    if (typeof body.max_tokens === "number") {
      body.max_tokens = Math.min(body.max_tokens, MAX_TOKENS_CAP);
    } else {
      body.max_tokens = 1024;
    }
    if (typeof body.model !== "string" || !ALLOWED_MODELS.has(body.model)) {
      body.model = "claude-sonnet-4-6";
    }

    try {
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(
        JSON.stringify({ error: String(err) }),
        { status: 502, headers: { ...headers, "Content-Type": "application/json" } },
      );
    }
  },
};
