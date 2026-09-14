#!/usr/bin/env python3
import hashlib
import json
import os
import shutil
import stat
import tarfile
import tempfile
import urllib.request
from pathlib import Path

API = "https://api.github.com/repos/tonhowtf/omniget/releases/latest"
TARGET = Path(os.environ.get("OMNIGET_BIN", "/usr/local/bin/omniget"))
LICENSE_TARGET = Path("/opt/omniget/LICENSE")

def request_json(url):
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "dragon-omniget-bootstrap",
        },
    )
    with urllib.request.urlopen(req, timeout=45) as response:
        return json.load(response)

def download(url, target):
    req = urllib.request.Request(url, headers={"User-Agent": "dragon-omniget-bootstrap"})
    with urllib.request.urlopen(req, timeout=120) as response, open(target, "wb") as out:
        shutil.copyfileobj(response, out)

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    release = request_json(API)
    assets = release.get("assets") or []
    asset = next(
        (
            a for a in assets
            if a.get("name", "").startswith("omniget-cli-")
            and a.get("name", "").endswith("-x86_64-unknown-linux-gnu.tar.gz")
        ),
        None,
    )
    if not asset:
        raise SystemExit("No OmniGet Linux x86_64 CLI release asset found.")

    with tempfile.TemporaryDirectory(prefix="omniget-") as td:
        archive = Path(td) / "omniget.tar.gz"
        download(asset["browser_download_url"], archive)

        digest = str(asset.get("digest") or "")
        if digest.startswith("sha256:"):
            expected = digest.split(":", 1)[1].lower()
            actual = sha256(archive).lower()
            if actual != expected:
                raise SystemExit("OmniGet CLI checksum verification failed.")

        extract = Path(td) / "extract"
        extract.mkdir()
        with tarfile.open(archive, "r:gz") as tf:
            tf.extractall(extract)

        candidates = [
            p for p in extract.rglob("*")
            if p.is_file() and p.name in {"omniget", "omniget-cli"}
        ]
        if not candidates:
            raise SystemExit("OmniGet CLI binary not found inside release archive.")

        TARGET.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidates[0], TARGET)
        TARGET.chmod(TARGET.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    LICENSE_TARGET.parent.mkdir(parents=True, exist_ok=True)
    download("https://raw.githubusercontent.com/tonhowtf/omniget/main/LICENSE", LICENSE_TARGET)

    print(json.dumps({
        "installed": str(TARGET),
        "version": release.get("tag_name"),
        "asset": asset.get("name"),
        "sha256_verified": bool(str(asset.get("digest") or "").startswith("sha256:")),
    }))

if __name__ == "__main__":
    main()
