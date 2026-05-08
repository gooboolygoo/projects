# projects

A new tiny website every day, by [@gooboolygoo](https://github.com/gooboolygoo).

Live at **<https://gooboolygoo.github.io/projects/>**.

Each project is a single `index.html` (plus optional assets). A GitHub Actions workflow injects a Buy Me a Coffee button, deploys to GitHub Pages at `gooboolygoo.github.io/projects/<slug>/`, and (in later phases) generates a tweet + a 9:16 promo video and fans the post out to X, TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts via Postiz Cloud.

## Daily workflow

1. Create a new folder under `sites/` named with a short kebab-case slug:

   ```
   sites/<slug>/
   ├─ index.html
   ├─ meta.yml
   └─ assets/        (optional)
   ```

2. Fill in `meta.yml`:

   ```yaml
   title: A short human title
   blurb: One sentence describing what this project is.
   tags:
     - tag-a
     - tag-b
   donate: true       # set to false to suppress the donate button
   ```

3. Build locally to preview:

   ```bash
   npm install         # first time only
   npm run build       # outputs to public/
   npm run preview     # builds and serves public/ on a local port
   ```

4. Commit and push to `main`. The workflow at [`.github/workflows/publish-daily.yml`](.github/workflows/publish-daily.yml) will rebuild and redeploy.

   The site goes live at `https://gooboolygoo.github.io/projects/<slug>/`.

## Slug rules

- Lowercase letters, digits, and hyphens only (no spaces, no underscores, no leading/trailing hyphens).
- Must be unique across `sites/`. The build will fail loudly on a duplicate or invalid slug.
- No date prefix — pick a name that describes the project (`pomodoro`, `chord-finder`, `tide-clock`).

## What the build does

The build script ([`scripts/build.ts`](scripts/build.ts)):

1. Wipes `public/`.
2. For each `sites/<slug>/`:
   - Validates the slug.
   - Reads and validates `meta.yml`.
   - Copies the folder to `public/<slug>/` (excluding `meta.yml`).
   - Injects [`shared/donate-snippet.html`](shared/donate-snippet.html) before `</body>` of `index.html` (skipped if `donate: false`).
3. Generates `public/index.html` listing every project.
4. Writes an empty `public/.nojekyll` so Pages serves files starting with `_`.

## First-time GitHub setup (Day 0)

1. Create the repo on GitHub: `gooboolygoo/projects` (public).
2. Push this folder:

   ```bash
   git init
   git add -A
   git commit -m "Day 0: scaffold daily-site pipeline"
   git branch -M main
   git remote add origin https://github.com/gooboolygoo/projects.git
   git push -u origin main
   ```

3. Enable Pages: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. The first push (or a manual `Run workflow`) will deploy to `https://gooboolygoo.github.io/projects/`.

## Phase 1 — Promo copy generation

After authoring a site, generate tweet copy and a 30-second video script with Claude:

```bash
cp .env.example .env                # first time only
# put your real ANTHROPIC_API_KEY in .env

npm run promo                       # generate for every site missing promo.json
npm run promo -- hello              # generate for one specific slug
npm run promo -- hello -f           # force-regenerate even if promo.json exists
```

The script writes `sites/<slug>/promo.json` looking like:

```json
{
  "generated_at": "2026-05-08T...",
  "model": "claude-haiku-4-5",
  "url": "https://gooboolygoo.github.io/projects/hello/",
  "hashtags": ["..."],
  "x": {
    "tweet": "main post body, no URL, no inline hashtags",
    "reply_lead": "live here \u2192"
  },
  "vertical_caption": "TikTok + Reels caption body, no URL, no hashtags",
  "shorts_description_lead": "YouTube Shorts description body, no URL, no hashtags",
  "video": {
    "title": "Day One: Proving the Pipeline",
    "script": "...",
    "word_count": 78
  }
}
```

Claude generates only creative copy. Phase 3 composes the final per-platform string by stitching copy with the URL and hashtags in the right slot for each platform:

| Platform        | Title             | Body                                                                         |
| --------------- | ----------------- | ---------------------------------------------------------------------------- |
| **X**           | (none)            | post `x.tweet`, then post `${x.reply_lead} ${url}` as the first reply        |
| **TikTok**      | (none)            | `${vertical_caption}\n\n${url}\n\n#tag1 #tag2 #tag3`                         |
| **Reels**       | (none)            | `${vertical_caption}\n\n${url}\n\n#tag1 #tag2 #tag3`                         |
| **YouTube Shorts** | `video.title` | `${shorts_description_lead}\n\n${url}\n\n#tag1 #tag2 #tag3`                  |

Review and edit `promo.json` by hand if you want — Phase 2 (video) and Phase 3 (cross-posting) read whatever you commit. `promo.json` is excluded from the deployed Pages output, so it never leaks publicly.

Cost: ~$0.003 per site at Claude Haiku 4.5 rates ($1/$5 per million tokens).

## Phase 2 — Promo video

After `promo.json` exists for a site, render a 9:16 ~30 s vertical MP4:

```bash
npm run video                          # render every site missing promo.mp4
npm run video -- hello                 # render one slug
npm run video -- hello -f              # overwrite an existing promo.mp4
npm run video -- hello --source live   # capture from the deployed URL instead of public/
```

The output lands at `sites/<slug>/promo.mp4` (~5 – 8 MB) and is committed alongside `promo.json` so Phase 3 can upload it directly. It is excluded from the deployed Pages output.

What the pipeline does, in order:

1. **TTS**: [`scripts/video/tts.ts`](scripts/video/tts.ts) sends `video.script` from `promo.json` to Microsoft Edge TTS via [`edge-tts-universal`](https://www.npmjs.com/package/edge-tts-universal). It captures the MP3 stream plus per-word timing offsets (100-ns units → ms).
2. **Capture**: [`scripts/video/capture.ts`](scripts/video/capture.ts) launches Playwright at 1080×1920 dark-mode and screenshots the page at 4 evenly-spaced scroll positions. By default it uses `public/<slug>/index.html` (run `npm run build` first); pass `--source live` once the site is on Pages.
3. **Render**: [`scripts/render-video.ts`](scripts/render-video.ts) bundles the Remotion project at [`remotion/`](remotion/) with `publicDir` pointing at the temp `.video-cache/` folder, then `selectComposition` + `renderMedia` produces `promo.mp4` at H.264 / 30 fps.

The Remotion composition (see [`remotion/Promo.tsx`](remotion/Promo.tsx)) is:

- `0 – 2 s` — title card with the project's `meta.title`.
- `2 s – ~25 s` — voiceover plays over Ken-Burns-zoomed screenshots, with word-by-word captions highlighting the active word in yellow.
- last `3 s` — outro card with "Try it yourself" and the project URL.

Total cost per video: $0 (Edge TTS, Playwright, Remotion are all free; Claude generated the script in Phase 1). Render time on an Apple Silicon Mac: ~20 – 25 s wall-clock.

### Notes on dependencies

- Playwright pulls a ~96 MB Chromium binary on first install via `npx playwright install chromium`. The first `npm run video` after a fresh clone may also take ~30 s while Remotion downloads its own Chrome Headless Shell to `node_modules/`.
- If Playwright complains it can't find Chromium (which can happen after npm postinstall in some sandboxed editors), set `PLAYWRIGHT_BROWSERS_PATH=$HOME/Library/Caches/ms-playwright` in the shell before running.
- `.video-cache/` (intermediate audio + screenshots) is gitignored. `promo.mp4` is committed.

## Phase 3 — Cross-posting via Postiz Cloud

After `promo.json` and `promo.mp4` exist, fan the project out to X, TikTok, Instagram Reels, Facebook Reels, and YouTube Shorts in one shot.

### One-time Postiz setup

1. Sign up at [platform.postiz.com](https://platform.postiz.com) (the Cloud plan is fine — $29/mo).
2. Connect each channel (Settings → Channels): X, TikTok, Instagram (use **Instagram Standalone** unless you have a linked Facebook Page), Facebook (must be a Page, not a personal profile — Meta does not allow API posts to profiles), YouTube.
3. Create an API key: Settings → Developers → Public API. Copy the value.
4. Put the key in `.env`:

   ```bash
   POSTIZ_API_KEY=...
   ```

### Running it

```bash
npm run post -- hello                            # save as draft on Postiz (default)
npm run post -- hello --now                      # publish immediately to all connected platforms
npm run post -- hello --schedule 2026-05-08T20:00:00Z   # schedule for a specific UTC time
npm run post -- hello --platforms x,tiktok       # restrict to a subset
npm run post -- hello --dry-run                  # print the composed payload, no API calls
```

The default is `draft` so you can review the post in the Postiz UI before clicking publish — useful while you're getting comfortable. Switch to `--now` once you trust it.

### What it does

[`scripts/post.ts`](scripts/post.ts) does three Postiz API calls per slug (well under the 30 req/hour limit):

1. `GET /integrations` to look up the integration ID for each connected platform.
2. `POST /upload` to upload `promo.mp4` (multipart; returns `{id, path}`).
3. `POST /posts` with one batched body containing five `PostItem`s — one per platform — composed as:

   | Platform           | What gets sent |
   | ------------------ | -------------- |
   | **X**              | 2-tweet thread: tweet 1 = `x.tweet` with the video; tweet 2 = `${x.reply_lead} ${url}` (no media). `who_can_reply_post: everyone`. |
   | **TikTok**         | Single video post. Caption = `${vertical_caption}\n\n${url}\n\n#hashtags`. Privacy `PUBLIC_TO_EVERYONE`, comments/duet/stitch on, posted directly via `DIRECT_POST`. |
   | **Instagram**      | Single video post (IG auto-classifies as Reel from the 9:16 file). Caption = `${vertical_caption}\n\n${url}\n\n#hashtags`. Prefers Instagram Standalone if connected, falls back to FB-linked Instagram. |
   | **Facebook**       | Single video post to your Page (FB auto-classifies as Reel from the 9:16 file). Caption = `${vertical_caption}\n\n${url}\n\n#hashtags`. URL goes in the caption, not as a link-preview, so the video stays the primary attachment. |
   | **YouTube Shorts** | Single video post. Title = `video.title` (≤ 100 chars). Description = `${shorts_description_lead}\n\n${url}\n\n#hashtags`. Visibility public, not made-for-kids, hashtags also passed as YouTube tags. |

   If a platform isn't connected on Postiz, it's skipped with a warning instead of failing the whole run.

After a successful run, `sites/<slug>/post.json` is written as a receipt (mode, scheduled time, platforms, Postiz response). Like `promo.json` and `promo.mp4`, this file is excluded from the deployed Pages output.

Cost: $29/month for Postiz Cloud, flat. No per-post fees.

## End-to-end automation: push → publish → promote

The full daily flow is wired into GitHub Actions across two workflows:

1. [`publish-daily.yml`](.github/workflows/publish-daily.yml) — on push to `main`, builds and deploys to Pages.
2. [`promote-daily.yml`](.github/workflows/promote-daily.yml) — runs after `publish-daily` succeeds. For each slug under `sites/` that has `index.html` + `meta.yml` but no `post.json` yet, it runs `npm run promo` → `npm run video` → `npm run post -- <slug> --now` and commits the resulting `promo.json`, `promo.mp4`, and `post.json` back to `main` with `[skip ci]` so it doesn't loop.

The `post.json` receipt is the gate: once a slug has been posted, future pushes never re-promote it. Add a new site folder, push, and it gets promoted exactly once.

### One-time setup for the cron

1. **Add repo secrets** at `https://github.com/gooboolygoo/projects/settings/secrets/actions`:
   - `ANTHROPIC_API_KEY` — for promo copy generation.
   - `POSTIZ_API_KEY` — for cross-posting.
2. **Connect channels on Postiz**: X, TikTok, Instagram (Standalone), Facebook (a Page, not a profile), YouTube. Re-run the workflow after connecting a channel and it'll start including that platform.
3. The default workflow `GITHUB_TOKEN` already has the `contents: write` scope needed for the auto-commit.

### Manual override

Use `Run workflow` on `Promote daily site` in the Actions tab to:

- Promote a specific slug (`slug = pomodoro`) without waiting for a push.
- Switch posting `mode` to `draft` (saves to Postiz drafts UI for review) or `schedule` (with an ISO `schedule` input) for testing.

To re-promote a slug whose site you've changed, delete its `sites/<slug>/post.json` and push — the cron will treat it as pending again.

### Loop safety

The auto-commit by the workflow uses `[skip ci]`, and pushes signed by `GITHUB_TOKEN` don't trigger new workflow runs by default — two layers of protection against an infinite promote loop.

## Roadmap

Possible next steps:

- Add a `--review` flag to `npm run post` that opens the rendered `promo.mp4` in your default player before posting.
- Add Postiz analytics polling (`GET /posts/{id}/analytics`) so the receipt eventually includes views/likes per platform.
- Surface a tiny dashboard at `gooboolygoo.github.io/projects/` showing the latest post receipts.
