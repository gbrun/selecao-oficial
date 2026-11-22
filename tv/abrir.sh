#!/usr/bin/env bash
# Reconecta à TV e abre o app Seleção Oficial. Uso: ./tv/abrir.sh [ip-da-tv]   (padrão: 192.168.68.53)
set -euo pipefail
IP="${1:-${TV_IP:-192.168.68.53}}"
TOOLS="${TIZEN_TOOLS:-$HOME/bin/server/sdktools/data/tools}"
SDB="$TOOLS/sdb"; TIZEN="$TOOLS/ide/bin/tizen"
[[ -x "$SDB" && -x "$TIZEN" ]] || { echo "Não achei o sdb/tizen em $TOOLS (ajuste TIZEN_TOOLS)."; exit 1; }
for i in 1 2 3; do   # o primeiro connect costuma falhar ou ficar offline
  "$SDB" connect "$IP:26101" >/dev/null 2>&1 || true; sleep 1
  "$SDB" devices | grep -q "$IP:26101[[:space:]]*device" && break
done
"$SDB" devices | grep -q "$IP:26101[[:space:]]*device" || { echo "TV $IP não conectou. Ela está ligada, na mesma rede e com o Developer mode On (host = IP deste Mac)?"; exit 1; }
for i in 1 2 3; do   # o sdb às vezes ainda está subindo na primeira tentativa
  NAME="$("$SDB" devices | awk -v ip="$IP:26101" '$1==ip {print $3}')"
  if [[ -n "$NAME" ]] && OUT="$("$TIZEN" run -p SelOfic001.SelecaoOficial -t "$NAME" 2>&1)" && grep -q "successfully launched" <<<"$OUT"; then
    echo "Seleção Oficial aberto na TV."; exit 0
  fi
  sleep 2; "$SDB" connect "$IP:26101" >/dev/null 2>&1 || true
done
echo "Não consegui abrir o app. Última resposta: ${OUT:-sem resposta}"; exit 1
