import asyncio
import ipaddress
import json
import os
import shutil
import socket
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

APP_NAME = "DRAGON OmniGet Web Engine"
TOKEN = os.environ.get("OMNIGET_WEB_TOKEN", "")
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OMNIGET_BIN = os.environ.get("OMNIGET_BIN", str(PROJECT_ROOT / ".tools" / "omniget"))
OUTPUT_ROOT = Path(os.environ.get("OUTPUT_ROOT", "/tmp/dragon-omniget"))
MAX_FILE_BYTES = int(os.environ.get("MAX_FILE_BYTES", str(250 * 1024 * 1024)))
JOB_TTL_SECONDS = int(os.environ.get("JOB_TTL_SECONDS", "1800"))
DOWNLOAD_TIMEOUT_SECONDS = int(os.environ.get("DOWNLOAD_TIMEOUT_SECONDS", "600"))
ALLOWED_HOSTS = {
    h.strip().lower().lstrip(".")
    for h in os.environ.get("OMNIGET_ALLOWED_HOSTS", "").split(",")
    if h.strip()
}

OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
app = FastAPI(title=APP_NAME)
jobs = {}


class MediaRequest(BaseModel):
    url: str
    authorized: bool = False
    mode: str = "audio"


def auth(authorization: str | None):
    if not TOKEN:
        raise HTTPException(503, "OMNIGET_WEB_TOKEN is not configured.")
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "Unauthorized.")


def host_allowed(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == allowed or host.endswith("." + allowed) for allowed in ALLOWED_HOSTS)


async def validate_target(raw_url: str, authorized: bool):
    if not authorized:
        raise HTTPException(400, "Authorization confirmation is required.")

    parsed = urlparse(raw_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(400, "Only valid http/https URLs are accepted.")

    host = parsed.hostname.lower()
    if not ALLOWED_HOSTS:
        raise HTTPException(
            503,
            "No permitted media hosts are configured on this DRAGON deployment.",
        )
    if not host_allowed(host):
        raise HTTPException(403, "This media host is not enabled for this deployment.")

    try:
        infos = await asyncio.get_running_loop().run_in_executor(
            None,
            lambda: socket.getaddrinfo(
                host,
                parsed.port or (443 if parsed.scheme == "https" else 80),
            ),
        )
    except socket.gaierror:
        raise HTTPException(400, "The media host could not be resolved.")

    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise HTTPException(403, "Private or local network targets are not allowed.")

    return raw_url.strip()


def cleanup():
    cutoff = time.time() - JOB_TTL_SECONDS
    expired = [
        job_id
        for job_id, job in jobs.items()
        if job.get("updated_at", 0) < cutoff
    ]
    for job_id in expired:
        job = jobs.pop(job_id, None)
        if not job:
            continue
        directory = job.get("directory")
        if directory:
            shutil.rmtree(directory, ignore_errors=True)


async def run_command(*args, timeout=90):
    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        raise HTTPException(504, "OmniGet operation timed out.")

    out = stdout.decode("utf-8", "replace")
    err = stderr.decode("utf-8", "replace")
    if proc.returncode != 0:
        detail = err.strip().splitlines()[-1] if err.strip() else "OmniGet failed."
        raise HTTPException(422, detail[:500])
    return out


def parse_json_lines(text):
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


@app.get("/health")
async def health():
    cleanup()
    return {
        "ok": True,
        "engine": "omniget-cli",
        "binary": os.path.exists(OMNIGET_BIN),
        "allowedHostsConfigured": bool(ALLOWED_HOSTS),
        "allowedHostCount": len(ALLOWED_HOSTS),
        "maxFileBytes": MAX_FILE_BYTES,
    }


@app.post("/v1/info")
async def info(req: MediaRequest, authorization: str | None = Header(default=None)):
    auth(authorization)
    cleanup()
    url = await validate_target(req.url, req.authorized)
    out = await run_command(OMNIGET_BIN, "--json", "info", url, timeout=120)
    rows = parse_json_lines(out)
    return {"ok": True, "result": rows[-1] if rows else {"raw": out[-4000:]}}


async def process_job(job_id: str, url: str, mode: str):
    job = jobs[job_id]
    directory = Path(job["directory"])
    args = [OMNIGET_BIN, "--json", "download", url, "-o", str(directory)]
    if mode == "audio":
        args.append("--audio-only")

    job["status"] = "running"
    job["updated_at"] = time.time()

    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(), timeout=DOWNLOAD_TIMEOUT_SECONDS
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise RuntimeError("Download timed out.")

        out = stdout.decode("utf-8", "replace")
        err = stderr.decode("utf-8", "replace")
        rows = parse_json_lines(out)
        complete = next((row for row in reversed(rows) if row.get("type") == "complete"), None)

        if proc.returncode != 0 or (complete and not complete.get("success", True)):
            message = (
                (complete or {}).get("error")
                or (err.strip().splitlines()[-1] if err.strip() else None)
                or "OmniGet failed."
            )
            raise RuntimeError(str(message)[:500])

        files = [p for p in directory.rglob("*") if p.is_file()]
        if not files:
            raise RuntimeError("OmniGet completed but no output file was found.")

        file_path = max(files, key=lambda p: p.stat().st_mtime)
        size = file_path.stat().st_size
        if size > MAX_FILE_BYTES:
            shutil.rmtree(directory, ignore_errors=True)
            raise RuntimeError("The processed file is larger than this deployment allows.")

        job.update({
            "status": "complete",
            "updated_at": time.time(),
            "file": str(file_path),
            "filename": file_path.name,
            "size": size,
        })
    except Exception as exc:
        job.update({
            "status": "error",
            "updated_at": time.time(),
            "error": str(exc)[:500],
        })


@app.post("/v1/download")
async def download(req: MediaRequest, authorization: str | None = Header(default=None)):
    auth(authorization)
    cleanup()
    url = await validate_target(req.url, req.authorized)
    mode = req.mode if req.mode in {"audio", "video"} else "audio"

    job_id = uuid.uuid4().hex
    directory = OUTPUT_ROOT / job_id
    directory.mkdir(parents=True, exist_ok=False)

    jobs[job_id] = {
        "id": job_id,
        "status": "queued",
        "mode": mode,
        "directory": str(directory),
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    asyncio.create_task(process_job(job_id, url, mode))
    return {"ok": True, "jobId": job_id, "status": "queued"}


@app.get("/v1/jobs/{job_id}")
async def job_status(job_id: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    cleanup()
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found or expired.")

    payload = {
        "id": job_id,
        "status": job["status"],
        "mode": job["mode"],
    }
    if job["status"] == "complete":
        payload.update({
            "filename": job["filename"],
            "size": job["size"],
            "downloadPath": f"/v1/files/{job_id}",
        })
    if job["status"] == "error":
        payload["error"] = job.get("error", "Unknown error.")
    return payload


@app.get("/v1/files/{job_id}")
async def get_file(job_id: str, authorization: str | None = Header(default=None)):
    auth(authorization)
    cleanup()
    job = jobs.get(job_id)
    if not job or job.get("status") != "complete":
        raise HTTPException(404, "File is not ready or has expired.")

    path = Path(job["file"])
    if not path.is_file():
        raise HTTPException(404, "File no longer exists.")

    return FileResponse(
        path,
        filename=job["filename"],
        media_type="application/octet-stream",
    )
