FROM ubuntu:22.04

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

# Install Python packages
RUN pip3 install websockets JACK-Client python-osc numpy

WORKDIR /app

COPY start.sh server.py ./
RUN chmod +x start.sh

EXPOSE 8080

CMD ["./start.sh"]
