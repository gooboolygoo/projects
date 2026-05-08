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

## Roadmap

- **Phase 1 — Tweet generation.** `scripts/generate-content.ts` calls the Anthropic API (Claude Haiku) on each new site to produce tweet copy and a 30-second video script, saved to `sites/<slug>/promo.json`.
- **Phase 2 — Promo video.** `scripts/render-video.ts` uses Playwright + Edge TTS + Remotion to render a 9:16 ~30s MP4 from the live URL, the script, and the AI voiceover. Optional AI b-roll inserts via the ZSky/Veo free tiers.
- **Phase 3 — Cross-posting.** `scripts/post.ts` uploads the MP4 + tweet copy to Postiz Cloud and schedules fanout to X, TikTok, Instagram Reels, and YouTube Shorts. Requires `POSTIZ_API_KEY` and `ANTHROPIC_API_KEY` in repo secrets.

The phases drop in incrementally — none of them break the Day 0 build/deploy.
