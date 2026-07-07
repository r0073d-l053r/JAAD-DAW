# JAAD Stem-Separation Sidecar — Demucs (htdemucs)
# CPU by default (works everywhere). For the GPU on your AI server, see
# docker-compose.stems.yml — uncomment the `gpus` block and swap in the CUDA
# torch index URL below for ~10-30x faster separations.

FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1

# ffmpeg: demucs/torchaudio use it to read/write audio robustly
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# torch install index. Default = CPU (small, works everywhere). For GPU, build
# with --build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu121 (or the
# cuXXX matching the host driver) and enable the GPU block in the compose file.
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
# soundfile (libsndfile) gives torchaudio a WAV write backend — the torch wheel
# bundles none, and system ffmpeg 7.x is too new for torchaudio's ffmpeg backend,
# so without this demucs separates fine but fails when saving the stems.
RUN pip install --no-cache-dir torch torchaudio --index-url ${TORCH_INDEX_URL} && \
    pip install --no-cache-dir "demucs==4.0.1" "fastapi==0.115.6" "uvicorn==0.34.0" "python-multipart==0.0.20" "soundfile==0.13.1"

WORKDIR /app
COPY server.py ./

# Non-root, same posture as the DSP sidecar. Model weights download to
# ~/.cache/torch on first run; a volume mounts at /home/jaad/.cache to persist
# them. Pre-create that dir owned by jaad so a fresh named volume inherits jaad
# ownership (otherwise Docker creates the mount root-owned and the download of
# the weights fails with EACCES).
RUN useradd --create-home --home-dir /home/jaad --shell /usr/sbin/nologin jaad && \
    mkdir -p /home/jaad/.cache && \
    chown -R jaad:jaad /app /home/jaad
ENV HOME=/home/jaad
USER jaad

EXPOSE 8000

CMD ["python3", "server.py"]
