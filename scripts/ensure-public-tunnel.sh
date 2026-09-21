#!/usr/bin/env bash
# Reusa el túnel público si ya está vivo.
# NUNCA lances otro `cloudflared tunnel --url` mientras exista uno:
# cada restart de un quick tunnel inventa un hostname trycloudflare NUEVO.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL_FILE="$ROOT/data/public-url.txt"
SESSION="gastos-public-tunnel"
KEEP_WIN="keep"
KEEPALIVE="$ROOT/scripts/cloudflared-keepalive.sh"
LOCAL_TARGET="http://127.0.0.1:4731"
TMUX=(tmux -f /exec-daemon/tmux.portal.conf)
if [[ ! -f /exec-daemon/tmux.portal.conf ]]; then
  TMUX=(tmux)
fi

read_saved_url() {
  if [[ -f "$URL_FILE" ]]; then
    tr -d '[:space:]' < "$URL_FILE"
  fi
}

url_from_running_tunnel() {
  "${TMUX[@]}" has-session -t "=$SESSION" 2>/dev/null || return 1
  local pane
  while IFS= read -r pane; do
    "${TMUX[@]}" capture-pane -t "$pane" -p -S -400 2>/dev/null || true
  done < <("${TMUX[@]}" list-panes -t "$SESSION" -s -F '#{session_name}:#{window_index}.#{pane_index}' 2>/dev/null) \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' \
    | tail -n 1
}

tunnel_process_up() {
  pgrep -f '[c]loudflared tunnel --url' >/dev/null 2>&1
}

keepalive_up() {
  pgrep -f '[c]loudflared-keepalive' >/dev/null 2>&1
}

url_responds() {
  local url="$1"
  [[ -n "$url" ]] || return 1
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$url/" || true)"
  [[ "$code" =~ ^(200|301|302|303|307|308)$ ]]
}

print_and_save() {
  local url="$1"
  printf '%s\n' "$url"
  mkdir -p "$(dirname "$URL_FILE")"
  printf '%s\n' "$url" > "$URL_FILE"
}

ensure_session() {
  "${TMUX[@]}" has-session -t "=$SESSION" 2>/dev/null || \
    "${TMUX[@]}" new-session -d -s "$SESSION" -c "$ROOT" -- "${SHELL:-bash}" -l
}

# Arranca el waiter/loop en una ventana aparte. NUNCA C-c a la ventana 0
# si ahí vive el túnel actual (perderíamos el hostname).
ensure_keepalive() {
  ensure_session
  if ! "${TMUX[@]}" list-windows -t "$SESSION" -F '#{window_name}' 2>/dev/null | grep -qx "$KEEP_WIN"; then
    "${TMUX[@]}" new-window -t "$SESSION" -n "$KEEP_WIN" -c "$ROOT" -- "${SHELL:-bash}" -l
    sleep 0.8
  fi
  if keepalive_up; then
    return 0
  fi
  "${TMUX[@]}" send-keys -t "$SESSION:$KEEP_WIN" C-c 2>/dev/null || true
  sleep 0.3
  "${TMUX[@]}" send-keys -t "$SESSION:$KEEP_WIN" "bash '$KEEPALIVE'" C-m
}

SAVED="$(read_saved_url || true)"
LIVE="$(url_from_running_tunnel || true)"

if tunnel_process_up; then
  # Túnel ya corre: reusar. No relanzar cloudflared.
  ensure_keepalive
  CHOSEN="${LIVE:-$SAVED}"
  if [[ -z "$CHOSEN" ]]; then
    echo "Túnel cloudflared ya está en marcha; no se lanza otro." >&2
    echo "No pude leer el hostname. Mira tmux $SESSION." >&2
    exit 0
  fi
  if url_responds "$CHOSEN"; then
    echo "Túnel ya activo. Reusando (no se crea otro hostname):"
    print_and_save "$CHOSEN"
    exit 0
  fi
  echo "cloudflared ya corre; no se lanza otro túnel aunque curl falle ahora." >&2
  echo "URL guardada/detectada: $CHOSEN" >&2
  print_and_save "$CHOSEN"
  exit 0
fi

echo "No hay túnel vivo. Un quick tunnel NO puede recuperar el hostname anterior." >&2
if [[ -n "$SAVED" ]]; then
  echo "La URL anterior era $SAVED — queda obsoleta si se crea una nueva." >&2
fi

if ! command -v cloudflared >/dev/null 2>&1 && [[ ! -x /tmp/cloudflared ]]; then
  echo "cloudflared no está instalado; no se puede abrir un túnel de recambio." >&2
  exit 1
fi

ensure_keepalive

for _ in $(seq 1 30); do
  sleep 1
  LIVE="$(url_from_running_tunnel || true)"
  if [[ -n "$LIVE" ]]; then
    echo "Túnel de recambio (última URL; no volver a cambiarla):"
    print_and_save "$LIVE"
    exit 0
  fi
done

echo "cloudflared arrancó pero no publicó hostname a tiempo. Revisa tmux $SESSION." >&2
exit 1
