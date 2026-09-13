import os
import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask
from yt_dlp import YoutubeDL

app = FastAPI(title="DRAGON Downloader", version="2.0")

BRIDGE_TOKEN = os.environ.get("DRAGON_BRIDGE_TOKEN", "")


def require_token(authorization: str | None) -> None:
    expected = f"Bearer {BRIDGE_TOKEN}"
    if not BRIDGE_TOKEN or authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def validate_source_url(url: str) -> None:
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL")

    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="HTTPS source required")

    allowed_hosts = {
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "youtu.be",
    }

    if parsed.hostname not in allowed_hosts:
        raise HTTPException(status_code=400, detail="Only YouTube URLs are accepted")


def safe_name(value: str, limit: int = 120) -> str:
    bad = '<>:"/\\|?*\0'
    cleaned = "".join(ch for ch in (value or "dragon-media") if ch not in bad)
    cleaned = " ".join(cleaned.split()).strip(". ")
    return (cleaned[:limit] or "dragon-media")


@app.get("/health")
def health():
    return {
        "ok": True,
        "engine": "yt-dlp + FFmpeg",
        "style": "OmniGet-inspired",
        "host": "Render",
    }


@app.get("/api/download")
def download(
    url: str = Query(...),
    format: str = Query("mp3"),
    authorization: str | None = Header(default=None),
):
    require_token(authorization)
    validate_source_url(url)

    fmt = format.strip().lower()
    if fmt not in {"mp3", "mp4"}:
        raise HTTPException(status_code=400, detail="Format must be mp3 or mp4")

    temp_dir = Path(tempfile.mkdtemp(prefix="dragon-"))

    try:
        if fmt == "mp3":
            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": str(temp_dir / "%(id)s.%(ext)s"),
                "noplaylist": True,
                "restrictfilenames": True,
                "quiet": True,
                "no_warnings": True,
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "192",
                    }
                ],
            }
        else:
            ydl_opts = {
                "format": (
                    "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/"
                    "best[height<=720][ext=mp4]/best[height<=720]"
                ),
                "merge_output_format": "mp4",
                "outtmpl": str(temp_dir / "%(id)s.%(ext)s"),
                "noplaylist": True,
                "restrictfilenames": True,
                "quiet": True,
                "no_warnings": True,
            }

        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)

        title = safe_name(info.get("title") or info.get("id") or "dragon-media")
        ext = ".mp3" if fmt == "mp3" else ".mp4"

        candidates = sorted(
            p for p in temp_dir.iterdir()
            if p.is_file() and p.suffix.lower() == ext
        )

        if not candidates:
            candidates = sorted(
                (p for p in temp_dir.iterdir() if p.is_file()),
                key=lambda p: p.stat().st_size,
                reverse=True,
            )

        if not candidates:
            raise HTTPException(status_code=500, detail="Downloader produced no file")

        file_path = candidates[0]
        download_name = title + ext
        media_type = "audio/mpeg" if fmt == "mp3" else "video/mp4"

        def cleanup() -> None:
            shutil.rmtree(temp_dir, ignore_errors=True)

        return FileResponse(
            path=str(file_path),
            filename=download_name,
            media_type=media_type,
            background=BackgroundTask(cleanup),
        )

    except HTTPException:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=f"Download failed: {exc}")
