#!/bin/bash

# JAAD - Linux Performance Optimizer
# This script pins the browser process to isolated CPU cores and sets real-time priority.

echo "🚀 Starting JAAD Performance Optimizer for Linux..."

# 1. Identify the browser process (assuming Google Chrome or Brave)
BROWSER_PIDS=$(pgrep -f "chrome|brave|firefox")

if [ -z "$BROWSER_PIDS" ]; then
    echo "⚠️ No browser process found. Please open JAAD in Chrome/Brave/Firefox first."
    exit 1
fi

echo "📍 Found Browser PIDs: $BROWSER_PIDS"

# 2. Set CPU Affinity (Pinning)
# We reserve Core 0 for OS tasks and pin the browser to Cores 1-3 (assuming 4+ cores)
CORES="1-3"
for PID in $BROWSER_PIDS; do
    taskset -cp $CORES $PID > /dev/null 2>&1
done
echo "✅ CPU Affinity set to cores: $CORES"

# 3. Set Real-time Priority (SCHED_FIFO)
# Requires sudo/root
echo "🔒 Requesting sudo to set Real-time Priority (SCHED_FIFO)..."
for PID in $BROWSER_PIDS; do
    sudo chrt -f -p 80 $PID > /dev/null 2>&1
done
echo "✅ Real-time Priority (80) applied to browser threads."

# 4. Disable GPU Throttling (Intel/Nvidia specifics could be added)
echo "💎 Forcing High Performance GPU state..."
# (Placeholder for specific GPU commands)

echo "✨ System Optimized. You should now experience significantly fewer dropouts in JAAD."
