#!/usr/bin/env bash
# Junta todos los documentos de docs/ en un solo archivo para subir a NotebookLM.
# Uso (desde la raíz del repo): bash scripts/consolidar.sh
set -euo pipefail
cd "$(dirname "$0")/.."

SALIDA="PROYECTO_TRAZABILIDAD.md"
{
  echo "# Proyecto de Trazabilidad · Inyección de plástico (documento consolidado)"
  echo
  echo "> Generado el $(date '+%Y-%m-%d %H:%M'). Este archivo se arma a partir de docs/. No editarlo a mano."
  echo
  for f in docs/*.md; do
    echo
    echo "---"
    echo
    cat "$f"
    echo
  done
} > "$SALIDA"

echo "Listo: $SALIDA"
