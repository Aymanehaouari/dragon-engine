# DRAGON Desktop

DRAGON Desktop packages the existing DRAGON interface as a Windows application.

The Windows build bundles the OmniGet CLI and its local runtime tools inside the
DRAGON installer. Users install DRAGON once; there is no separate OmniGet
installation or `omniget://` protocol registration required.

## Local flow

1. Install and open DRAGON.
2. Paste a media URL in the OmniGet section.
3. Confirm that you have the right to save the media.
4. Choose Audio or Video.
5. DRAGON runs its bundled OmniGet CLI locally.
6. The result is saved to the Windows Downloads folder.

The Cloudflare Worker is still used for DRAGON's YouTube search API. Media
processing through OmniGet happens locally inside the desktop application.

## Build on Windows

```powershell
cd desktop
powershell -ExecutionPolicy Bypass -File .\scripts\fetch-tools.ps1
npm install
npm run build
```

The NSIS installer is produced under:

`desktop/src-tauri/target/release/bundle/nsis/`

## Third-party software

The build script downloads official release artifacts for OmniGet, yt-dlp, and
FFmpeg. The installer includes `THIRD_PARTY_NOTICES.txt` with upstream source
and licensing information.
