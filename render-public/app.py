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

app = FastAPI(title="DRAGON Public Gateway")

if (PUBLIC / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(PUBLIC / "assets")), name="assets")


@app.get("/health")
async def health():
    return {"ok": True, "upstream": UPSTREAM}


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_api(path: str, request: Request):
    target = f"{UPSTREAM}/api/{path}"
    params = list(request.query_params.multi_items())
    body = await request.body()

    forward_headers = {}
    content_type = request.headers.get("content-type")
    if content_type:
        forward_headers["content-type"] = content_type

    client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=20.0))
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
        return FileResponse(requested, media_type=media_type)

    index = PUBLIC / "index.html"
    return FileResponse(index, media_type="text/html")
