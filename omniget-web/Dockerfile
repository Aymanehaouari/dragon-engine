FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    OMNIGET_BIN=/usr/local/bin/omniget \
    OUTPUT_ROOT=/tmp/dragon-omniget

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY omniget-web/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY omniget-web/install_omniget.py /app/install_omniget.py
RUN python /app/install_omniget.py

# OmniGet CLI expects yt-dlp for generic media resolution.
RUN python -m pip install --no-cache-dir yt-dlp

COPY omniget-web/app.py /app/app.py

EXPOSE 8080
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8080}"]
