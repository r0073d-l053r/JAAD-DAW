FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive

# Install base dependencies and enable 32-bit architecture for Wine
RUN dpkg --add-architecture i386 && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    wget \
    curl \
    gnupg2 \
    apt-transport-https \
    software-properties-common \
    xvfb \
    x11vnc \
    novnc \
    websockify \
    jackd2 \
    libjack-jackd2-dev \
    python3 \
    python3-pip \
    python3-numpy \
    wine \
    wine64 \
    wine32 && \
    rm -rf /var/lib/apt/lists/*

# Add KXStudio repositories for Carla and win bridges
RUN wget https://launchpad.net/~kxstudio-debian/+archive/kxstudio/+files/kxstudio-repos_11.2.0_all.deb && \
    dpkg -i kxstudio-repos_11.2.0_all.deb && \
    rm kxstudio-repos_11.2.0_all.deb && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
    carla-git \
    carla-bridge-win64 \
    carla-bridge-win32 && \
    rm -rf /var/lib/apt/lists/*

# Install Python packages (pinned for reproducible, auditable builds).
# --break-system-packages: Ubuntu 26.04 ships Python 3.14, which marks the system
# interpreter PEP 668 "externally-managed" and refuses a bare `pip install`. This
# container is a single-purpose appliance (no OS Python apps to protect) and the
# Carla/numpy bindings we rely on are apt-installed system-wide, so installing
# these three pure-Python packages alongside them is safe and intentional.
RUN pip3 install --no-cache-dir --break-system-packages \
    "websockets==13.1" \
    "JACK-Client==0.5.4" \
    "python-osc==1.8.3"

WORKDIR /app

COPY start.sh server.py ./
RUN chmod +x start.sh

# Run as a non-root user so a bug in the (network-facing) bridge or a loaded
# plugin can't act as root inside the container. Wine/JACK(dummy)/Xvfb all run
# fine unprivileged given a writable HOME.
RUN useradd --create-home --home-dir /home/jaad --shell /usr/sbin/nologin jaad && \
    chown -R jaad:jaad /app
ENV HOME=/home/jaad \
    WINEPREFIX=/home/jaad/.wine \
    XDG_RUNTIME_DIR=/home/jaad/.run
RUN mkdir -p /home/jaad/.run && chown -R jaad:jaad /home/jaad
USER jaad

# 8080 = DSP/parameter WebSocket · 6080 = noVNC (live plugin GUI)
EXPOSE 8080 6080

CMD ["./start.sh"]
