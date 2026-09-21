#!/usr/bin/env bash
# Un solo quick tunnel. Si cloudflared ya corre y el hostname sigue en DNS,
# espera (mismo hostname). Un restart SÍ inventa un trycloudflare nuevo.
#
# Excepción: el pid puede seguir vivo con el túnel ya muerto en Cloudflare
# ("Unauthorized: Tunnel not found" + NXDOMAIN). Eso no se recupera: hay que
# matar ESE proceso y dejar que arranque uno solo. No lances otro en paralelo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL_FILE="$ROOT/data/public-url.txt"
LOG_FILE="/tmp/gastos-cloudflared-quick.log"
LOCAL_TARGET="http://127.0.0.1:4731"
# Seconds of NXDOMAIN + "Tunnel not found" before we give up on this pid.
STUCK_GRACE_SECS="${STUCK_GRACE_SECS:-45}"

TMUX=(tmux -f /exec-daemon/tmux.portal.conf)
if [[ ! -f /exec-daemon/tmux.portal.conf ]]; then
  TMUX=(tmux)
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
  echo "$(date -u +%FT%TZ) keepalive: $*"
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

hostname_in_dns() {
  local host="$1"
  [[ -n "$host" ]] || return 1
  getent hosts "$host" >/dev/null 2>&1
}

log_says_tunnel_not_found() {
  local src=""
  if [[ -f "$LOG_FILE" ]]; then
    src="$(tail -n 40 "$LOG_FILE" 2>/dev/null || true)"
    if printf '%s' "$src" | grep -q 'Unauthorized: Tunnel not found'; then
      return 0
    fi
  fi
  # Solo paneles cuyo comando actual es cloudflared (no scrollback de un pane ya muerto).
  local pane
  while IFS= read -r pane; do
    [[ -n "$pane" ]] || continue
    src="$("${TMUX[@]}" capture-pane -t "$pane" -p -S -40 2>/dev/null || true)"
    if printf '%s' "$src" | grep -q 'Unauthorized: Tunnel not found'; then
      return 0
    fi
  done < <("${TMUX[@]}" list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{pane_current_command}' 2>/dev/null | awk '$NF=="cloudflared"{print $1}')
  return 1
}

# True only when this pid cannot re-register the old name.
# A QUIC/1033 blip that still resolves in DNS must NOT match.
tunnel_irrecoverable() {
  local url host
  url="$(saved_url || true)"
  [[ -n "$url" ]] || return 1
  host="$(host_from_url "$url")"
  if hostname_in_dns "$host"; then
    return 1
  fi
  log_says_tunnel_not_found
}

stop_stuck_tunnel() {
  local pids
  pids="$(tunnel_pids)"
  [[ -n "$pids" ]] || return 0
  log "old hostname is gone (NXDOMAIN + Tunnel not found); stopping pid(s) $pids"
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
  : > "$LOG_FILE"
}

wait_while_up() {
  log "cloudflared already running; waiting (keep hostname)"
  local stuck_since=""
  while tunnel_up; do
    scrape_url_from_log
    if tunnel_irrecoverable; then
      if [[ -z "$stuck_since" ]]; then
        stuck_since="$(date +%s)"
        log "hostname NXDOMAIN and Cloudflare says Tunnel not found; grace ${STUCK_GRACE_SECS}s"
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
  log "previous cloudflared exited"
}

run_one() {
  log "starting cloudflared -> $LOCAL_TARGET"
  mkdir -p "$(dirname "$URL_FILE")"
  : > "$LOG_FILE"
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
  log "cloudflared exited — next start gets a NEW hostname"
}

# Watchdog for a tunnel started here via run_one (foreground pipe).
# wait_while_up covers a tunnel that was started in another pane.
watch_irrecoverable_in_background() {
  (
    local stuck_since=""
    while true; do
      sleep 5
      if ! tunnel_up; then
        exit 0
      fi
      if tunnel_irrecoverable; then
        if [[ -z "$stuck_since" ]]; then
          stuck_since="$(date +%s)"
          log "watchdog: NXDOMAIN + Tunnel not found; grace ${STUCK_GRACE_SECS}s"
        else
          local now
          now="$(date +%s)"
          if (( now - stuck_since >= STUCK_GRACE_SECS )); then
            stop_stuck_tunnel
            exit 0
          fi
        fi
      else
        stuck_since=""
      fi
    done
  ) &
  echo $!
}

if tunnel_up; then
  wait_while_up
fi

while true; do
  if tunnel_up; then
    wait_while_up
    continue
  fi
  WATCH_PID="$(watch_irrecoverable_in_background)"
  run_one
  kill "$WATCH_PID" 2>/dev/null || true
  wait "$WATCH_PID" 2>/dev/null || true
  sleep 2
done
