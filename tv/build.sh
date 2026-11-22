#!/usr/bin/env bash
# Empacota a página como app da TV Samsung (.wgt), assina e (opcional) instala.
# Uso: ./tv/build.sh https://SEU-USUARIO.github.io/selecao-oficial/ [perfil] [ip-da-tv:26101]
set -euo pipefail
URL="${1:?Informe a URL do site, ex.: https://seu-usuario.github.io/selecao-oficial/}"
PROFILE="${2:-SelecaoOficial}"
TARGET="${3:-}"
[[ "$URL" == */ ]] || URL="$URL/"
TIZEN="${TIZEN:-$(command -v tizen || true)}"
[[ -x "${TIZEN:-}" ]] || { echo "Não achei o CLI 'tizen'. Rode: TIZEN=/caminho/tizen ./tv/build.sh ..."; exit 1; }
DIR="$(cd "$(dirname "$0")" && pwd)"; OUT="$DIR/build"
rm -rf "$OUT" && mkdir -p "$OUT"
cp "$DIR/config.xml" "$DIR/icon.png" "$OUT/"
# Mesma página do site; na TV ela busca o catálogo no GitHub Pages, então não precisa reinstalar a cada atualização.
sed "s#window.SO_DATA_BASE = window.SO_DATA_BASE || '';#window.SO_DATA_BASE = '$URL';#" "$DIR/../public/index.html" > "$OUT/index.html"
grep -q "SO_DATA_BASE = '$URL'" "$OUT/index.html" || { echo "Falha ao configurar a URL dos dados."; exit 1; }
"$TIZEN" package -t wgt -s "$PROFILE" -- "$OUT"
WGT="$(ls "$OUT"/*.wgt | head -1)"; echo "Gerado: $WGT"
if [[ -n "$TARGET" ]]; then
  "$TIZEN" install -n "$(basename "$WGT")" -s "$TARGET" -- "$OUT"
  echo "Instalado. Procure \"Seleção Oficial\" em Apps na TV."
fi
