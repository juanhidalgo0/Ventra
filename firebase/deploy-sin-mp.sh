#!/usr/bin/env bash
# Publica funciones de Ventra sin la integración de Mercado Pago de cada comercio.
# Firebase exige los secretos de TODAS las funciones del código aunque se publiquen
# solo algunas; mientras VENTRA_MP_CLIENT_ID / _SECRET no estén cargados, el bloque
# de Mercado Pago (al final de functions/index.js) se saca durante el deploy y se
# vuelve a poner tal cual al terminar, pase lo que pase.
#
# Uso (desde la carpeta firebase):
#   bash deploy-sin-mp.sh ventraSync ventraDailySummary ventraAdmin
set -u
cd "$(dirname "$0")"
[ $# -gt 0 ] || { echo "Indicá qué funciones publicar"; exit 1; }

INDEX=functions/index.js
BAK=$(mktemp)
cp "$INDEX" "$BAK"
trap 'cp "$BAK" "$INDEX"; cmp -s "$INDEX" "$BAK" && echo "index.js restaurado"; rm -f "$BAK"' EXIT

N=$(grep -n "Mercado Pago de cada comercio" "$INDEX" | cut -d: -f1)
[ -n "$N" ] || { echo "No encontré el bloque de Mercado Pago"; exit 1; }
head -n $((N - 1)) "$BAK" > "$INDEX"
node -e "require('./functions/index.js')" || { echo "index.js no carga sin el bloque"; exit 1; }

ONLY=$(printf "functions:ventra:%s," "$@")hosting:web
npx firebase deploy --only "$ONLY"
