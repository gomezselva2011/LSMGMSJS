#!/usr/bin/env bash
# Un solo quick tunnel. Si cloudflared ya corre, espera (mismo hostname).
# Solo relanza el binario cuando el proceso ya murió. Ese relanzamiento
# SÍ inventa un hostname trycloudflare nuevo — por eso no se mata el vivo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL_FILE="$ROOT/data/public-url.txt"
LOG_FILE="/tmp/gastos-cloudflared-quick.log"
LOCAL_TARGET="http://127.0.0.1:4731"

if command -v cloudflared >/dev/null 2>&1; then
  CLOUDFLARED="$(command -v cloudflared)"
elif [[ -x /tmp/cloudflared ]]; then
  CLOUDFLARED=/tmp/cloudflared
else
  echo "cloudflared no está instalado" >&2
  exit 1
fi

tunnel_up() {
  pgrep -f '[c]loudflared tunnel --url' >/dev/null 2>&1
}

save_url_from_text() {
  local url
  url="$(printf '%s' "$1" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -n 1 || true)"
  if [[ -n "$url" ]]; then
    mkdir -p "$(dirname "$URL_FILE")"
    printf '%s\n' "$url" > "$URL_FILE"
  fi
}

wait_while_up() {
  echo "$(date -u +%FT%TZ) keepalive: cloudflared already running; waiting (keep hostname)"
  while tunnel_up; do
    sleep 5
  done
  echo "$(date -u +%FT%TZ) keepalive: previous cloudflared exited"
}

run_one() {
  echo "$(date -u +%FT%TZ) keepalive: starting cloudflared -> $LOCAL_TARGET"
  mkdir -p "$(dirname "$URL_FILE")"
  : >> "$LOG_FILE"
  set +e
  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf -oL -eL "$CLOUDFLARED" tunnel --url "$LOCAL_TARGET" --no-autoupdate 2>&1 \
      | tee -a "$LOG_FILE" \
      | while IFS= read -r line; do
          printf '%s\n' "$line"
          save_url_from_text "$line"
        done
  else
    "$CLOUDFLARED" tunnel --url "$LOCAL_TARGET" --no-autoupdate 2>&1 \
      | tee -a "$LOG_FILE" \
      | while IFS= read -r line; do
          printf '%s\n' "$line"
          save_url_from_text "$line"
        done
  fi
  set -e
  echo "$(date -u +%FT%TZ) keepalive: cloudflared exited — next start gets a NEW hostname"
}

if tunnel_up; then
  wait_while_up
fi

while true; do
  if tunnel_up; then
    wait_while_up
    continue
  fi
  run_one
  sleep 2
done
