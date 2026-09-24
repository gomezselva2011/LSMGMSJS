#!/usr/bin/env bash
# Copia consistente de data/gastos.sqlite SIN matar Vite ni truncar el WAL en vivo.
# No subas este archivo a git: tiene datos del hogar (aunque las claves vayan hasheadas).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="${GASTOS_DATA_DIR:-$ROOT/data}"
SRC="$SRC_DIR/gastos.sqlite"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST_DIR="${1:-$ROOT/exports/gastos-$STAMP}"

if [[ ! -f "$SRC" ]]; then
  echo "No hay sqlite en $SRC" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"

if command -v sqlite3 >/dev/null 2>&1; then
  # Copia en caliente (API backup); no interrumpe el proceso que tiene el archivo abierto.
  sqlite3 "$SRC" ".backup '$DEST_DIR/gastos.sqlite'"
else
  echo "sqlite3 no está en PATH; copiando el archivo y el WAL tal cual." >&2
  cp -a "$SRC" "$DEST_DIR/gastos.sqlite"
  [[ -f "$SRC-wal" ]] && cp -a "$SRC-wal" "$DEST_DIR/gastos.sqlite-wal"
  [[ -f "$SRC-shm" ]] && cp -a "$SRC-shm" "$DEST_DIR/gastos.sqlite-shm"
fi

# Avatares (fotos de perfil), si existen.
if [[ -d "$SRC_DIR/avatars" ]]; then
  mkdir -p "$DEST_DIR/avatars"
  cp -a "$SRC_DIR/avatars/." "$DEST_DIR/avatars/" 2>/dev/null || true
fi

{
  echo "origen=$SRC"
  echo "exportado=$DEST_DIR/gastos.sqlite"
  echo "cuando=${STAMP}"
  echo "bytes=$(wc -c < "$DEST_DIR/gastos.sqlite" | tr -d ' ')"
} > "$DEST_DIR/README.txt"

echo "Export listo: $DEST_DIR"
echo "No lo commits. Súbelo al disco persistente (ver docs/hosting-gratis.md)."
echo "En Render Shell (plan de pago), ejemplo:"
echo "  mkdir -p \"\${GASTOS_DATA_DIR:-/var/data}\""
echo "  # luego copia gastos.sqlite a \$GASTOS_DATA_DIR/gastos.sqlite"
