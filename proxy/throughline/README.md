# throughline-proxy

A Cloudflare Worker that proxies POST requests from `sites/throughline/index.html` to the Anthropic API. Keeps the API key server-side. CORS-locked to `gooboolygoo.github.io` and localhost.

## Deploy

```sh
cd proxy/throughline

# one-time
npm install -g wrangler
wrangler login

# set the secret (uses the same ANTHROPIC_API_KEY you already have in .env)
wrangler secret put ANTHROPIC_API_KEY
# (paste the key when prompted, then enter)

# deploy
wrangler deploy
```

Wrangler will print the deployed URL, e.g.
`https://throughline-proxy.YOUR-CF-NAME.workers.dev`

## Wire the frontend

Open `sites/throughline/index.html` and set:

```html
<meta name="api-base" content="https://throughline-proxy.YOUR-CF-NAME.workers.dev" />
```

Commit + push. Visitors now get real Claude responses; the canned demo
flow is skipped automatically when `api-base` is non-empty.

## Tail logs

```sh
wrangler tail
```

## Free tier

Cloudflare Workers free tier: 100,000 requests/day. Plenty for a portfolio demo.
Sonnet 4.6 cost per Throughline session: ~$0.04 (interview + synthesis + paths).

## What the worker does

- Accepts POST only from `gooboolygoo.github.io` (rejects other origins, 403)
- Forwards the JSON body to Anthropic with `x-api-key` from the secret
- Caps `max_tokens` at 4000
- Restricts `model` to a small allowlist
- Returns the upstream response verbatim with CORS headers
