# DRAGON — YouTube discovery + Cloudflare R2 downloads

DRAGON now separates listening from downloading:

- YouTube Data API: search/discovery
- Official YouTube embed: listening
- Cloudflare R2: files you own or are permitted to distribute
- Cloudflare Worker: maps YouTube video IDs to R2 objects and serves downloads
- Durable Object MediaRegistry: stores the mapping

Render and yt-dlp are no longer part of the download path.

## Required Cloudflare setup

Create an R2 bucket named:

`dragon-media`

The Worker configuration already binds it as:

`MEDIA`

Keep these secrets/variables:

- `YOUTUBE_API_KEY`
- `ADMIN_TOKEN`

The old Render variables are no longer used by the Worker:

- `DOWNLOAD_BACKEND_URL`
- `DOWNLOAD_BRIDGE_TOKEN`
- `AUTHORIZED_VIDEO_IDS`
- `AUTHORIZED_CHANNEL_IDS`

They can be removed after the new deployment is working.

## Deploy

The GitHub repository is connected to Cloudflare.

Deploy command:

`npx wrangler deploy`

## Admin

Open:

`/admin.html`

Enter `ADMIN_TOKEN`.

For each file:
1. Enter the matching YouTube video URL or video ID.
2. Select MP3 or MP4.
3. Pick your local file.
4. Upload.

The file is stored in R2 and mapped to the YouTube video ID.

## User flow

Search:
YouTube API → DRAGON

Listen:
DRAGON → official YouTube embed

Download:
DRAGON → Cloudflare Worker → R2 → browser

The download itself does not call YouTube and does not use Render.
