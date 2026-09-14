# DRAGON — Listen-only music interface

DRAGON is now a lightweight listening interface powered by the official YouTube search API and YouTube IFrame Player.

## Features

- Search YouTube music
- Clean premium dark interface
- In-app playback with the YouTube IFrame Player API
- Queue
- Previous / next controls
- Seek bar and timestamps
- Recent searches saved locally in the browser
- Load more results
- Open any track directly on YouTube
- Responsive desktop and mobile design

There is no download backend, no Render dependency, no R2 requirement, no admin panel, and no download flow.

## Cloudflare

Required Worker variable:

- `YOUTUBE_API_KEY`

Deploy with:

`npx wrangler deploy`

Health check:

`/api/health`

Expected mode:

`listen-only`
