#!/usr/bin/env bash
# Compila el print-agent (../agent.mjs) a un .exe de Windows con pkg.
#
# ⚠️ --public --public-packages "*" ES OBLIGATORIO: embebe el CÓDIGO FUENTE en
# vez de bytecode V8. Sin eso, un build cross-platform (ej. desde macOS) mete
# bytecode del host que el V8 de Windows RECHAZA al arrancar:
#   Error: [pkg] V8 rejected the bytecode cache ... mismatched host/target V8
# (aprendido a la mala, 2026-07-24 — crasheó en golf en loop). Lo ideal es
# buildear en Windows; si cross-compilás, --public es innegociable.
#
# Y OJO: un .exe de Windows NO se puede ejecutar/verificar desde macOS. Probalo
# SIEMPRE en una PC Windows real antes de publicarlo (ver README).
#
# Uso:  ./build-exe.sh            → dist/print-agent.exe (node22-win-x64)
#       PKG_TARGET=node22-win-x64 ./build-exe.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
AGENT="$HERE/../agent.mjs"
OUT="$HERE/dist/print-agent.exe"
TARGET="${PKG_TARGET:-node22-win-x64}"

[ -f "$AGENT" ] || { echo "✗ no encuentro el agente: $AGENT" >&2; exit 1; }
mkdir -p "$HERE/dist"

npx --yes @yao-pkg/pkg@latest "$AGENT" \
  --targets "$TARGET" \
  --public --public-packages "*" --no-bytecode \
  --output "$OUT"

echo "✓ $OUT ($(du -h "$OUT" | cut -f1)) — target $TARGET"
echo "  Siguiente: ../installer/armar-zip.sh \"$OUT\" print-agent.zip"
