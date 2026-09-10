# DRAGON — Cloudflare-only build

This version uses only Cloudflare at runtime:

- Cloudflare Worker: UI + YouTube Data API search + authorization gate
- Cloudflare Static Assets: HTML/CSS/JS
- Cloudflare Container: .NET 10 + FFmpeg + `Tyrrrz/YoutubeDownloader.Core`

The browser sends only a YouTube `videoId` to `/api/download`.
The Worker reconstructs the full YouTube URL internally and passes it to the container.

## Required Cloudflare variables/secrets

Set these on the Worker:

- `YOUTUBE_API_KEY` — your existing YouTube Data API key
- `AUTHORIZED_VIDEO_IDS` — comma-separated IDs of videos you own/control and want enabled for the integration test
- `AUTHORIZED_CHANNEL_IDS` — optional comma-separated channel IDs you own/control

At least one authorized ID/channel is required for download buttons to appear.

Example:

AUTHORIZED_VIDEO_IDS=ABCDEFGHIJK,12345678901
AUTHORIZED_CHANNEL_IDS=UCxxxxxxxxxxxxxxxxxxxxxx

## Deploy without Railway

Cloudflare Containers require the Workers Paid plan.

### Cloud-build route (no local Docker required)

1. Put this entire folder in a GitHub repository.
2. In Cloudflare Workers & Pages, connect/import that repository.
3. In the Worker's Build settings, use:
   - Deploy command: `npx wrangler deploy`
4. Add `YOUTUBE_API_KEY`, `AUTHORIZED_VIDEO_IDS`, and optionally `AUTHORIZED_CHANNEL_IDS` in Cloudflare settings.
5. Deploy the production branch.
6. The first container deployment can take several minutes.

Cloudflare Workers Builds can build the Dockerfile in Cloudflare's build environment, so Railway is not needed.

### Local route

If you prefer local deployment:
1. `npm install`
2. Start Docker Desktop
3. `npx wrangler deploy`

## Test

Open:

/api/health

Expected:

{"worker":true,"downloader":true}

Then search in the DRAGON UI.

For an authorized test video/channel:
- LISTEN plays with the official YouTube embed.
- DOWNLOAD sends only the video ID from the browser.
- The Worker constructs `https://www.youtube.com/watch?v=...` internally.
- The Worker passes that URL to the Cloudflare Container.
- The Container uses `Tyrrrz/YoutubeDownloader.Core` to produce the requested MP3/MP4.

For other YouTube results, listening still works but downloading stays locked.
