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
# O app é uma casca local que mostra o site (GitHub Pages, ?tv=1) num iframe e abre os apps da TV a pedido dele:
# só a página local tem a API tizen; o site precisa de uma origem https para o player do YouTube tocar.
cat > "$OUT/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>Seleção Oficial</title>
<style>html,body{margin:0;height:100%;background:#14080c}iframe{border:0;width:100%;height:100%;display:block}</style>
<iframe id="f" allow="autoplay; encrypted-media; fullscreen" src="__URL__?tv=1"></iframe>
<script>
var f = document.getElementById('f'), ORIGIN = new URL('__URL__').origin;
f.focus(); f.addEventListener('load', function(){ f.focus(); f.contentWindow.focus(); });
function reply(id, o){ o.so = 'tv-res'; o.id = id; f.contentWindow.postMessage(o, '*'); }
addEventListener('message', function(e){
  var m = e.data; if (e.origin !== ORIGIN || !m || m.so !== 'tv') return;
  if (m.op === 'exit'){ try { tizen.application.getCurrentApplication().exit(); } catch(x){} return; }
  if (m.op !== 'launch') return;
  tizen.application.getAppsInfo(function(list){
    var re = new RegExp(m.re, 'i'), app = null;
    // a TV lista também entradas de mentira (aria-dummy, primevideo-dummy) e serviços; prefere a que abre de verdade
    var bad = /dummy|service|companion|preview|worker|test/i, first = null;
    for (var i = 0; i < list.length; i++) if (re.test(list[i].name || '')){ first = first || list[i]; if (!bad.test(list[i].id) && !bad.test(list[i].name)){ app = list[i]; break; } }
    app = app || first;
    if (!app) return reply(m.id, {found: false});
    function plain(){ try { tizen.application.launch(app.id, function(){ reply(m.id, {found: true}); }, function(){ reply(m.id, {found: true, error: true}); }); } catch(x){ reply(m.id, {found: true, error: true}); } }
    if (!/netflix/i.test(m.re)) return plain();   // Prime/Apple/Disney ignoram o link; só abrem o app
    try { tizen.application.launchAppControl(new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', m.url, null, null, []), app.id, function(){ reply(m.id, {found: true}); }, plain); }
    catch(x){ plain(); }
  }, function(){ reply(m.id, {found: false}); });
});
</script>
HTML
sed -i.bak "s#__URL__#$URL#g" "$OUT/index.html" && rm "$OUT/index.html.bak"
"$TIZEN" package -t wgt -s "$PROFILE" -- "$OUT"
WGT="$(ls "$OUT"/*.wgt | head -1)"; echo "Gerado: $WGT"
# A TV recusa o instalador quando o nome do arquivo tem acento ou espaço; copia com nome simples.
cp "$WGT" "$OUT/SelecaoOficial.wgt"; rm "$WGT"; WGT="$OUT/SelecaoOficial.wgt"
if [[ -n "$TARGET" ]]; then
  "$TIZEN" install -n "$(basename "$WGT")" -s "$TARGET" -- "$OUT"
  echo "Instalado. Procure \"Seleção Oficial\" em Apps na TV."
fi
