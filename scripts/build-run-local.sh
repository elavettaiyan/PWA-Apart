#!/bin/sh
set -e

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SERVER_PORT="${PORT:-4000}"
CLIENT_PORT="${CLIENT_PORT:-4173}"

free_port() {
  port="$1"
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Stopping existing process on port $port: $pids"
    kill $pids
  fi
}

cd "$ROOT_DIR"

free_port "$SERVER_PORT"
free_port "$CLIENT_PORT"

echo "Building server and client..."
npm run build

echo "Starting built server on http://localhost:$SERVER_PORT ..."
echo "Starting client preview on http://localhost:$CLIENT_PORT ..."

exec npx concurrently \
  "PORT=$SERVER_PORT npm --prefix packages/server run start" \
  "npm --prefix packages/client run preview -- --host 0.0.0.0 --port $CLIENT_PORT --strictPort"