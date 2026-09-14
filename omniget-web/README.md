# DRAGON OmniGet Web Engine

This container runs **OmniGet CLI on the server**, so visitors do not need OmniGet installed on their phone or laptop.

## Upstream

Engine source:
https://github.com/tonhowtf/omniget

At image build time, `install_omniget.py` fetches the latest Linux x86_64 `omniget-cli` release asset and verifies the SHA-256 digest published by GitHub before installing it.

OmniGet is GPL-3.0. The upstream license is copied into the image at `/opt/omniget/LICENSE`.

## Deployment scope

The service is intentionally allowlist-only. Configure only domains that you own or for which your deployment has explicit permission to save media.

Required environment variables:

```
OMNIGET_WEB_TOKEN=<long-random-secret>
OMNIGET_ALLOWED_HOSTS=media.example.com,cdn.example.com
```

Optional:

```
MAX_FILE_BYTES=262144000
JOB_TTL_SECONDS=1800
DOWNLOAD_TIMEOUT_SECONDS=600
```

Do not configure broad third-party platforms merely to turn this into a public ripping proxy.

## Run locally

```bash
docker build -f omniget-web/Dockerfile -t dragon-omniget .
docker run --rm -p 8080:8080 \
  -e OMNIGET_WEB_TOKEN=change-me \
  -e OMNIGET_ALLOWED_HOSTS=media.example.com \
  dragon-omniget
```
