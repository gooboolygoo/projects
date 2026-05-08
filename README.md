# projects

A new tiny website every day, by [@gooboolygoo](https://github.com/gooboolygoo).

Live at **<https://gooboolygoo.github.io/projects/>**.

Each project is a single `index.html` (plus optional assets). A GitHub Actions workflow injects a Buy Me a Coffee button, deploys to GitHub Pages at `gooboolygoo.github.io/projects/<slug>/`, and (in later phases) generates a tweet + a 9:16 promo video and fans the post out to X, TikTok, Instagram Reels, and YouTube Shorts via Postiz Cloud.

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

## Roadmap

- **Phase 2 — Promo video.** `scripts/render-video.ts` uses Playwright + Edge TTS + Remotion to render a 9:16 ~30s MP4 from the live URL, the script, and the AI voiceover. Optional AI b-roll inserts via the ZSky/Veo free tiers.
- **Phase 3 — Cross-posting.** `scripts/post.ts` uploads the MP4 + tweet copy to Postiz Cloud and schedules fanout to X, TikTok, Instagram Reels, and YouTube Shorts. Requires `POSTIZ_API_KEY` (and the existing `ANTHROPIC_API_KEY`) in repo secrets.

The phases drop in incrementally — none of them break the Day 0 build/deploy.
