# JAAD Stem-Separation Sidecar — Demucs (htdemucs)
# CPU by default (works everywhere). For the GPU on your AI server, see
# docker-compose.stems.yml — uncomment the `gpus` block and swap in the CUDA
# torch index URL below for ~10-30x faster separations.

FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1

# ffmpeg: demucs/torchaudio use it to read/write audio robustly
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# CPU torch first (much smaller than the default CUDA wheel), then demucs.
# For GPU: replace the index-url with https://download.pytorch.org/whl/cu121
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir "demucs==4.0.1" "fastapi==0.115.6" "uvicorn==0.34.0" "python-multipart==0.0.20"

WORKDIR /app
COPY server.py ./

# Non-root, same posture as the DSP sidecar. Model weights download to HOME on
# first run; mount a volume at /home/jaad/.cache to persist them across restarts.
RUN useradd --create-home --home-dir /home/jaad --shell /usr/sbin/nologin jaad && \
    chown -R jaad:jaad /app
ENV HOME=/home/jaad
USER jaad

EXPOSE 8000

CMD ["python3", "server.py"]
