#!/usr/bin/env bash
# Un solo quick tunnel. Si cloudflared ya corre y el hostname sigue vivo,
# espera (mismo hostname). Un restart SÍ inventa un trycloudflare nuevo.
#
# El pid puede seguir vivo con el túnel ya muerto en Cloudflare
# ("Unauthorized: Tunnel not found" y/o NXDOMAIN). Eso no se recupera:
# mata ESE proceso y arranca uno solo. No lances otro en paralelo.
#
# El supervisor es este bucle en primer plano (tmux gastos-public-tunnel:keep).
# No uses un watchdog dentro de $(...): el subshell se cierra y el watcher muere.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL_FILE="$ROOT/data/public-url.txt"
LOG_FILE="/tmp/gastos-cloudflared-quick.log"
KEEP_LOG="/tmp/gastos-keepalive.log"
PID_FILE="/tmp/gastos-cloudflared.pid"
LOCAL_TARGET="http://127.0.0.1:4731"
# HTTP/2 is more stable here than QUIC (fewer 1033 "no recent network activity" drops).
CF_PROTOCOL="${CF_PROTOCOL:-http2}"
# Short grace: live-but-dead hostnames must not sit for minutes.
STUCK_GRACE_SECS="${STUCK_GRACE_SECS:-20}"

TMUX=(tmux -f /exec-daemon/tmux.portal.conf)
if [[ ! -f /exec-daemon/tmux.portal.conf ]]; then
  TMUX=(tmux)
fi

LOCK_FILE="/tmp/gastos-cloudflared-keepalive.lock"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "keepalive already running; not starting a second supervisor" >&2
  exit 0
fi

if command -v cloudflared >/dev/null 2>&1; then
  CLOUDFLARED="$(command -v cloudflared)"
elif [[ -x /tmp/cloudflared ]]; then
  CLOUDFLARED=/tmp/cloudflared
else
  echo "cloudflared no está instalado" >&2
  exit 1
fi

log() {
  local line
  line="$(date -u +%FT%TZ) keepalive: $*"
  printf '%s\n' "$line" | tee -a "$KEEP_LOG"
}

tunnel_pids() {
  pgrep -f '[c]loudflared tunnel --url' 2>/dev/null || true
}

tunnel_up() {
  [[ -n "$(tunnel_pids)" ]]
}

saved_url() {
  if [[ -f "$URL_FILE" ]]; then
    tr -d '[:space:]' < "$URL_FILE"
  fi
}

host_from_url() {
  local url="$1"
  url="${url#https://}"
  url="${url#http://}"
  printf '%s' "${url%%/*}"
}

save_url_from_text() {
  local url
  url="$(printf '%s' "$1" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -n 1 || true)"
  if [[ -n "$url" ]]; then
    mkdir -p "$(dirname "$URL_FILE")"
    printf '%s\n' "$url" > "$URL_FILE"
  fi
}

scrape_url_from_log() {
  if [[ -f "$LOG_FILE" ]]; then
    save_url_from_text "$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | tail -n 1 || true)"
  fi
}

advertised_url() {
  if [[ -f "$LOG_FILE" ]]; then
    grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" 2>/dev/null | tail -n 1 || true
  fi
}

hostname_in_dns() {
  local host="$1"
  [[ -n "$host" ]] || return 1
  # Un NXDOMAIN de trycloudflare a veces cuelga getent; no bloquear el supervisor.
  timeout 2 getent hosts "$host" >/dev/null 2>&1
}

recent_log() {
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 80 "$LOG_FILE" 2>/dev/null || true
  fi
}

log_says_tunnel_not_found() {
  local src
  src="$(recent_log)"
  if printf '%s' "$src" | grep -qE 'Unauthorized: Tunnel not found|Tunnel not found'; then
    return 0
  fi
  return 1
}

url_http_ok() {
  local url="$1"
  [[ -n "$url" ]] || return 1
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 -L "$url/login" || true)"
  [[ "$code" =~ ^(200|301|302|303|307|308)$ ]]
}

candidate_url() {
  local url
  url="$(advertised_url || true)"
  if [[ -z "$url" ]]; then
    url="$(saved_url || true)"
  fi
  printf '%s' "$url"
}

# True when this pid cannot re-register the current name.
# "Tunnel not found" is enough (DNS can lag). NXDOMAIN of the advertised
# or saved hostname is enough too. A 1033 blip that still resolves and is
# not "Tunnel not found" must NOT match. An empty advertised URL while
# still connecting is not NXDOMAIN — but a saved URL that no longer
# resolves means Cloudflare already dropped this quick tunnel.
tunnel_irrecoverable() {
  if log_says_tunnel_not_found; then
    return 0
  fi
  local url host
  url="$(candidate_url)"
  [[ -n "$url" ]] || return 1
  host="$(host_from_url "$url")"
  if hostname_in_dns "$host"; then
    return 1
  fi
  return 0
}

stop_stuck_tunnel() {
  local pids
  pids="$(tunnel_pids)"
  [[ -n "$pids" ]] || return 0
  log "old hostname is gone (NXDOMAIN and/or Tunnel not found); stopping pid(s) $pids"
  # One process only: never start a replacement until this exits.
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 2
  pids="$(tunnel_pids)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
  : > "$LOG_FILE"
}

start_one() {
  log "starting cloudflared -> $LOCAL_TARGET"
  mkdir -p "$(dirname "$URL_FILE")"
  : > "$LOG_FILE"
  set +e
  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf -oL -eL "$CLOUDFLARED" tunnel --url "$LOCAL_TARGET" --protocol "$CF_PROTOCOL" --no-autoupdate >>"$LOG_FILE" 2>&1 &
  else
    "$CLOUDFLARED" tunnel --url "$LOCAL_TARGET" --protocol "$CF_PROTOCOL" --no-autoupdate >>"$LOG_FILE" 2>&1 &
  fi
  local cf_pid=$!
  echo "$cf_pid" > "$PID_FILE"
  set -e
  log "cloudflared pid $cf_pid"
}

# Follow the log in this pane so tmux capture still sees the hostname.
start_log_tail() {
  tail -n +1 -F "$LOG_FILE" 2>/dev/null &
  echo $!
}

stop_log_tail() {
  local pid="${1:-}"
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  pkill -f '[t]ail -n +1 -F /tmp/gastos-cloudflared-quick.log' 2>/dev/null || true
}

supervise_running() {
  local stuck_since="" last_url="" url
  local tail_pid
  tail_pid="$(start_log_tail)"
  log "supervising live cloudflared (grace ${STUCK_GRACE_SECS}s)"
  while tunnel_up; do
    scrape_url_from_log
    url="$(advertised_url || true)"
    if [[ -n "$url" && "$url" != "$last_url" ]]; then
      log "hostname $url"
      last_url="$url"
      save_url_from_text "$url"
    fi
    if tunnel_irrecoverable; then
      if [[ -z "$stuck_since" ]]; then
        stuck_since="$(date +%s)"
        log "dead hostname (NXDOMAIN or Tunnel not found); grace ${STUCK_GRACE_SECS}s"
      else
        local now
        now="$(date +%s)"
        if (( now - stuck_since >= STUCK_GRACE_SECS )); then
          stop_stuck_tunnel
          break
        fi
      fi
    else
      stuck_since=""
    fi
    sleep 5
  done
  stop_log_tail "$tail_pid"
  log "previous cloudflared exited"
}

# If an older pane already has a tunnel, just supervise it.
if tunnel_up; then
  scrape_url_from_log
  supervise_running
fi

while true; do
  if tunnel_up; then
    supervise_running
    continue
  fi
  start_one
  supervise_running
  log "cloudflared exited — next start gets a NEW hostname"
  sleep 2
done
