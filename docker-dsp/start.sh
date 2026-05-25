#!/bin/bash
set -e

echo "🖥️ Starting Xvfb virtual display..."
Xvfb :99 -screen 0 1024x768x16 &
export DISPLAY=:99

echo "🔊 Starting JACK audio server..."
jackd -d dummy -r 44100 -p 1024 &

# Wait for JACK to be ready
sleep 2

echo "🐍 Starting Python DSP Sidecar..."
python3 server.py
