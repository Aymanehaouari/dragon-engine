# DRAGON — Cloudflare Free + Render Free

Architecture:

Cloudflare Worker (Free)
- serves DRAGON UI
- YouTube search
- official playback
- authorization gate
- reconstructs YouTube URL internally

Render Web Service (Free)
- Docker
- .NET 10
- FFmpeg
- Tyrrrz/YoutubeDownloader.Core
- handles authorized download test requests

## Render setup

Create a new Web Service from the same GitHub repository.

Settings:
- Root Directory: `render-backend`
- Runtime: Docker
- Plan: Free

Environment variable:
- `DRAGON_BRIDGE_TOKEN` = choose a long random secret

After deploy, copy the Render URL, for example:
`https://dragon-downloader.onrender.com`

## Cloudflare setup

Use the repository root for the Cloudflare Worker.

Deploy command:
`npx wrangler deploy`

Secrets / variables:
- `YOUTUBE_API_KEY`
- `DOWNLOAD_BACKEND_URL` = your Render URL
- `DOWNLOAD_BRIDGE_TOKEN` = same value as `DRAGON_BRIDGE_TOKEN`
- `AUTHORIZED_VIDEO_IDS` = comma-separated IDs you own/control for testing
- `AUTHORIZED_CHANNEL_IDS` = optional channel IDs you own/control

Important:
If the existing Cloudflare Worker has a different service name, change `"name"` in `wrangler.jsonc` to match it.

## Free-tier behavior

Render Free spins down after 15 minutes of inactivity. The first request after sleep can take roughly a minute to wake the backend. Temporary downloaded files are fine because Render's filesystem is ephemeral and DRAGON streams the result back to the browser.
