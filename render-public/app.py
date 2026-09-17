import os
import mimetypes
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
UPSTREAM = os.environ.get(
    "DRAGON_UPSTREAM",
    "https://dragon-music.aymanehaouari25.workers.dev",
).rstrip("/")
OMNIGET_BACKEND = os.environ.get(
    "OMNIGET_BACKEND_URL",
    "https://dragon-omniget-engine.onrender.com",
).rstrip("/")
OMNIGET_TOKEN = os.environ.get("OMNIGET_WEB_TOKEN", "")
ASSET_VERSION = "20260917-1"

app = FastAPI(title="DRAGON Public Gateway")

if (PUBLIC / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(PUBLIC / "assets")), name="assets")


@app.get("/health")
async def health():
    return {"ok": True, "upstream": UPSTREAM}


def omniget_target(path: str):
    if not path.startswith("omniget/"):
        return None

    suffix = path[len("omniget/"):]
    if suffix == "health":
        return f"{OMNIGET_BACKEND}/health"
    if suffix == "info":
        return f"{OMNIGET_BACKEND}/v1/info"
    if suffix == "download":
        return f"{OMNIGET_BACKEND}/v1/download"
    if suffix.startswith("jobs/"):
        return f"{OMNIGET_BACKEND}/v1/jobs/{suffix[len('jobs/'):]}"
    if suffix.startswith("files/"):
        return f"{OMNIGET_BACKEND}/v1/files/{suffix[len('files/'):]}"
    return None


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_api(path: str, request: Request):
    direct_omniget = omniget_target(path)
    target = direct_omniget or f"{UPSTREAM}/api/{path}"
    params = list(request.query_params.multi_items())
    body = await request.body()

    forward_headers = {}
    content_type = request.headers.get("content-type")
    if content_type:
        forward_headers["content-type"] = content_type

    if direct_omniget and path != "omniget/health":
        if not OMNIGET_TOKEN:
            return Response(
                '{"error":"OmniGet gateway token is not configured."}',
                status_code=503,
                media_type="application/json",
            )
        forward_headers["authorization"] = f"Bearer {OMNIGET_TOKEN}"

    client = httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=30.0))
    upstream = await client.send(
        client.build_request(
            request.method,
            target,
            params=params,
            headers=forward_headers,
            content=body if body else None,
        ),
        stream=True,
    )

    allowed = {}
    for name in ("content-type", "content-disposition", "content-length", "etag", "last-modified"):
        value = upstream.headers.get(name)
        if value:
            allowed[name] = value
    allowed["cache-control"] = "no-store"

    async def stream():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(stream(), status_code=upstream.status_code, headers=allowed)


@app.get("/{path:path}")
async def static_site(path: str):
    requested = (PUBLIC / path).resolve()

    try:
        requested.relative_to(PUBLIC.resolve())
    except ValueError:
        return Response("Not found", status_code=404)

    if path and requested.is_file():
        media_type, _ = mimetypes.guess_type(str(requested))
        return FileResponse(
            requested,
            media_type=media_type,
            headers={"Cache-Control": "no-store"},
        )

    index = PUBLIC / "index.html"
    html = index.read_text(encoding="utf-8")
    html = html.replace(
        "/native-audio.js?v=20260915-4",
        f"/native-audio.js?v={ASSET_VERSION}",
    )
    html = html.replace(
        "/app.js?v=20260915-4",
        f"/app.js?v={ASSET_VERSION}",
    )

    offline_script = f'<script src="/youtube-offline.js?v={ASSET_VERSION}"></script>'
    if offline_script not in html:
        html = html.replace("</body>", f"  {offline_script}\n</body>")

    return Response(
        html,
        media_type="text/html",
        headers={"Cache-Control": "no-store"},
    )
