#!/bin/bash
set -e

# Start virtual display
Xvfb :99 -screen 0 1280x900x24 &
export DISPLAY=:99

# Start VNC server (no password, localhost only — Cloudflare tunnel secures it)
x11vnc -display :99 -nopw -listen localhost -xkb -noxrecord -noxfixes -noxdamage -rfbport 5900 &

# Start noVNC websocket proxy on port 6080
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &

# Start the Node app
exec node dist/server.js
