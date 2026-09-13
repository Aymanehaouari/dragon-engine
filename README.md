# DRAGON — Cloudflare Free + Render Free (OmniGet-style backend)

This version replaces the previous .NET/YoutubeDownloader backend with a much smaller backend inspired by OmniGet's architecture:

- Cloudflare Worker (Free): search, UI, official YouTube playback, authorization gate
- Render Web Service (Free): Python + FastAPI + yt-dlp + FFmpeg
- No Cloudflare Containers
- No Railway

The browser sends only a YouTube `videoId` to Cloudflare. Cloudflare reconstructs the full YouTube URL internally and sends it to Render. The Render backend uses yt-dlp + FFmpeg.

## Repository layout

```text
index.js
wrangler.jsonc
package.json
public/
  index.html
  styles.css
  app.js
render-backend/
  app.py
  requirements.txt
  Dockerfile
  .dockerignore
```

## 1) Render setup

Create a new Render Web Service from this same GitHub repository.

Settings:

- Root Directory: `render-backend`
- Runtime: Docker
- Instance Type: Free

Add environment variable:

- `DRAGON_BRIDGE_TOKEN` = a long random secret

Deploy.

When Render gives you a URL like:

`https://dragon-downloader.onrender.com`

open:

`https://dragon-downloader.onrender.com/health`

Expected response contains:

`"engine":"yt-dlp + FFmpeg"`

## 2) Cloudflare setup

Use the repository root for the Worker.

Deploy command:

`npx wrangler deploy`

Add these Worker variables/secrets:

- `YOUTUBE_API_KEY`
- `DOWNLOAD_BACKEND_URL` = your Render URL
- `DOWNLOAD_BRIDGE_TOKEN` = exactly the same value as Render's `DRAGON_BRIDGE_TOKEN`
- `AUTHORIZED_VIDEO_IDS` = comma-separated YouTube video IDs you own/control for the test
- `AUTHORIZED_CHANNEL_IDS` = optional comma-separated channel IDs you own/control

If your existing Worker has a different service name, change `"name"` in `wrangler.jsonc` to match it.

Then redeploy.

## 3) Test

Open:

`https://YOUR-WORKER.workers.dev/api/health`

Expected:

`{"worker":true,"downloader":true}`

Then open DRAGON and search.

- LISTEN uses the official YouTube embed.
- DOWNLOAD appears only for video IDs/channels you explicitly authorized.
- Browser sends only the video ID.
- Cloudflare creates the YouTube URL internally.
- Cloudflare passes that URL to Render.
- Render runs yt-dlp + FFmpeg and streams the file back.

## Why this backend is smaller

OmniGet itself is a large Tauri/Rust desktop app, but its download workflow is built around yt-dlp + FFmpeg. For DRAGON's web backend, using the same underlying engine directly avoids shipping OmniGet's desktop UI, plugins, local database, browser extension and unrelated components.

This package does not copy OmniGet's application source.
