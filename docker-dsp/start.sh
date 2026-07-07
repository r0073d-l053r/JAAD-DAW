#!/bin/bash
set -e

echo "🖥️ Starting Xvfb virtual display..."
Xvfb :99 -screen 0 1024x768x16 &
export DISPLAY=:99
sleep 1

echo "🖧 Starting x11vnc + noVNC (live plugin GUI on :6080)..."
if [ -n "$JAAD_VNC_PASSWORD" ]; then
  x11vnc -display :99 -rfbport 5900 -localhost -forever -shared -passwd "$JAAD_VNC_PASSWORD" -bg -quiet
else
  echo "⚠️ JAAD_VNC_PASSWORD not set — noVNC has no VNC password (keep it to localhost / trusted LAN)."
  x11vnc -display :99 -rfbport 5900 -localhost -forever -shared -nopw -bg -quiet
fi
# Serve the noVNC web client and proxy it to the local x11vnc server.
websockify --web=/usr/share/novnc 6080 localhost:5900 &

echo "🔊 Starting JACK audio server..."
jackd -d dummy -r 44100 -p 1024 &

# Wait for JACK to be ready
sleep 2

echo "🐍 Starting Python DSP Sidecar..."
python3 server.py
