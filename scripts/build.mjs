#!/usr/bin/env node
// Seleção Oficial — robô diário.
// Coleta prêmios (Wikidata), disponibilidade no Brasil (TMDB) e notas (OMDb)
// e grava public/data/filmes.json e public/data/diretores.json.
// Uso: TMDB_KEY=... OMDB_KEY=... node scripts/build.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/data');
const CACHE = path.join(ROOT, 'data');
const TMDB_KEY = (process.env.TMDB_KEY || '').trim();
const OMDB_KEY = (process.env.OMDB_KEY || '').trim();
const OMDB_BUDGET = +(process.env.OMDB_BUDGET || 950);   // plano grátis: 1.000/dia
const TOP_DIRECTORS = +(process.env.TOP_DIRECTORS || 100);
const UA = 'SelecaoOficial/1.0 (catalogo pessoal de filmes de festival; GitHub Actions)';
const DAY = 864e5;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

if (!TMDB_KEY) { console.error('Falta o segredo TMDB_KEY.'); process.exit(1); }

const FESTS = {
  cannes:   ['Cannes Film Festival', 'Festival de Cannes'],
  veneza:   ['Venice Film Festival', 'Venice International Film Festival'],
  berlim:   ['Berlin International Film Festival', 'Berlinale'],
  oscar:    ['Academy Awards', 'Academy Award'],
  globo:    ['Golden Globes', 'Golden Globe Awards', 'Golden Globe Award'],
  sundance: ['Sundance Film Festival'],
  toronto:  ['Toronto International Film Festival']
};
const SVC = {
  netflix: {ids: [8, 1796], re: /netflix/i},
  prime:   {ids: [119, 10], re: /prime video|amazon video/i},
  disney:  {ids: [337], re: /disney/i},
  hbo:     {ids: [1899, 384], re: /hbo|^max$/i},
  apple:   {ids: [350, 2], re: /apple/i},
  google:  {ids: [3], re: /google/i}
};

async function readJSON(p, d) { try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return d; } }
async function writeJSON(p, v) { await fs.mkdir(path.dirname(p), {recursive: true}); await fs.writeFile(p, JSON.stringify(v)); }
let fatal = null;
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({length: n}, async () => {
    while (i < items.length && !fatal) {
      const it = items[i++];
      try { await fn(it); } catch (e) { if (e.fatal) fatal = e; else console.warn('  aviso:', e.message); }
    }
  }));
  if (fatal) throw fatal;
}

/* ---------------- Wikidata ---------------- */
const qid = uri => uri.slice(uri.lastIndexOf('/') + 1);
async function sparql(query) {
  for (let a = 0; a < 4; a++) {
    const r = await fetch('https://query.wikidata.org/sparql', {
      method: 'POST',
      headers: {'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json'},
      body: new URLSearchParams({query})
    }).catch(() => null);
    if (r?.ok) return (await r.json()).results.bindings;
    if (r && [500, 502, 504].includes(r.status) && a >= 1) throw new Error('timeout');
    await sleep(4000 * (a + 1));
  }
  throw new Error('Wikidata indisponível');
}
async function festAwards(labels) {
  const rows = await sparql(`SELECT DISTINCT ?award ?awardLabel WHERE {
    VALUES ?fname { ${labels.map(l => `"${l}"@en`).join(' ')} }
    ?fest rdfs:label ?fname .
    ?award (wdt:P31|wdt:P279|wdt:P361|wdt:P1027)? ?fest .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
  }`);
  return rows.map(r => ({q: qid(r.award.value), l: r.awardLabel?.value || ''})).filter(a => a.l && !/^Q\d+$/.test(a.l));
}
async function statements(ids) {
  const q = `SELECT ?film ?tmdb ?award ?k ?t WHERE {
    VALUES ?award { ${ids.map(i => 'wd:' + i).join(' ')} }
    { ?film p:P166 ?st . ?st ps:P166 ?award . BIND("w" AS ?k) }
    UNION { ?film p:P1411 ?st . ?st ps:P1411 ?award . BIND("n" AS ?k) }
    UNION { ?x p:P166 ?st . ?st ps:P166 ?award ; pq:P1686 ?film . BIND("w" AS ?k) }
    UNION { ?x p:P1411 ?st . ?st ps:P1411 ?award ; pq:P1686 ?film . BIND("n" AS ?k) }
    ?film wdt:P4947 ?tmdb .
    OPTIONAL { ?st pq:P585 ?t }
  }`;
  try { return await sparql(q); }
  catch (e) {
    if (ids.length > 1) { const h = ids.length >> 1; return [...await statements(ids.slice(0, h)), ...await statements(ids.slice(h))]; }
    console.warn('  prêmio ignorado (consulta falhou):', ids[0]); return [];
  }
}
async function loadWikidata() {
  const films = new Map();
  for (const [key, labels] of Object.entries(FESTS)) {
    const awards = await festAwards(labels);
    const label = new Map(awards.map(a => [a.q, a.l]));
    const chunks = [];
    for (let i = 0; i < awards.length; i += 25) chunks.push(awards.slice(i, i + 25).map(a => a.q));
    let rows = 0;
    await pool(chunks, 2, async ids => {
      for (const r of await statements(ids)) {
        rows++;
        const id = qid(r.film.value), a = label.get(qid(r.award.value)); if (!a) continue;
        let f = films.get(id);
        if (!f) { f = {q: id, tmdb: +r.tmdb.value, aw: [], en: null, nf: null, dirs: []}; films.set(id, f); }
        const y = r.t ? +r.t.value.slice(0, 4) : null, w = r.k.value === 'w' ? 1 : 0;
        const prev = f.aw.find(x => x.f === key && x.a === a && x.y === y);
        if (prev) prev.w = prev.w || w; else f.aw.push({f: key, a, y, w});
      }
    });
    log(`Wikidata ${key}: ${awards.length} prêmios, ${rows} registros`);
  }
  const ids = [...films.keys()], batches = [];
  for (let i = 0; i < ids.length; i += 250) batches.push(ids.slice(i, i + 250));
  await pool(batches, 2, async b => {
    const rows = await sparql(`SELECT ?film ?en ?nf ?dir ?dirLabel ?dt WHERE {
      VALUES ?film { ${b.map(i => 'wd:' + i).join(' ')} }
      OPTIONAL { ?film rdfs:label ?en FILTER(LANG(?en) = "en") }
      OPTIONAL { ?film wdt:P1874 ?nf }
      OPTIONAL { ?film wdt:P57 ?dir . OPTIONAL { ?dir wdt:P4985 ?dt } }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "pt-br,pt,en". }
    }`);
    for (const r of rows) {
      const f = films.get(qid(r.film.value)); if (!f) continue;
      if (r.en && !f.en) f.en = r.en.value;
      if (r.nf && !f.nf) f.nf = r.nf.value;
      if (r.dir) { const dq = qid(r.dir.value); if (!f.dirs.some(d => d.q === dq)) f.dirs.push({q: dq, n: r.dirLabel?.value || '', t: r.dt ? +r.dt.value : null}); }
    }
  });
  log(`Wikidata: ${films.size} filmes com ID do TMDB`);
  return [...films.values()];
}

/* ---------------- TMDB ---------------- */
async function tmdb(p, params = {}) {
  const u = new URL('https://api.themoviedb.org/3' + p);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const headers = {};
  if (TMDB_KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + TMDB_KEY; else u.searchParams.set('api_key', TMDB_KEY);
  for (let a = 0; a < 5; a++) {
    const r = await fetch(u, {headers}).catch(() => null);
    if (!r) { await sleep(1000 * (a + 1)); continue; }
    if (r.status === 401) { const e = new Error('O TMDB recusou a chave (TMDB_KEY).'); e.fatal = true; throw e; }
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) { await sleep(1000 * (a + 1)); continue; }
    if (!r.ok) return null;
    return r.json();
  }
  return null;
}
function svcOf(p) {
  if (/channel/i.test(p.provider_name)) return null;
  for (const [k, s] of Object.entries(SVC)) if (s.ids.includes(p.provider_id)) return k;
  for (const [k, s] of Object.entries(SVC)) if (s.re.test(p.provider_name)) return k;
  return null;
}
const movies = new Map();
function movie(id) { if (!movies.has(id)) movies.set(id, fetchMovie(id)); return movies.get(id); }
async function fetchMovie(id) {
  const d = await tmdb(`/movie/${id}`, {language: 'pt-BR', append_to_response: 'watch/providers'});
  if (!d) return null;
  const br = d['watch/providers']?.results?.BR, prov = {};
  if (br) for (const [list, kind] of [['flatrate', 'sub'], ['ads', 'sub'], ['free', 'sub'], ['rent', 'rent'], ['buy', 'rent']])
    for (const p of br[list] || []) { const s = svcOf(p); if (s) prov[s] = (kind === 'sub' || prov[s] === 'sub') ? 'sub' : 'rent'; }
  const ok = Object.keys(prov).length > 0;
  let ov = d.overview || '';
  if (ok && !ov) ov = (await tmdb(`/movie/${id}`, {language: 'en-US'}))?.overview || '';
  return {id, ok: ok ? 1 : 0, t: d.title, ot: d.original_title, ol: d.original_language,
    y: d.release_date ? +d.release_date.slice(0, 4) : null, rt: d.runtime || null, p: d.poster_path || null,
    ov: ok ? ov : (d.overview || ''), g: (d.genres || []).map(g => g.name), imdb: d.imdb_id || null,
    va: d.vote_average ? +d.vote_average.toFixed(1) : null, vc: d.vote_count || 0, prov};
}

/* ---------------- OMDb (incremental) ---------------- */
async function refreshRatings(cache, ids) {
  if (!OMDB_KEY) { log('OMDb: sem chave, pulando'); return; }
  const now = Date.now();
  const missing = ids.filter(i => !cache[i]);
  const stale = ids.filter(i => cache[i] && now - cache[i].ts > 30 * DAY).sort((a, b) => cache[a].ts - cache[b].ts);
  const todo = [...missing, ...stale].slice(0, OMDB_BUDGET);
  let done = 0, stop = false;
  await pool(todo, 4, async id => {
    if (stop) return;
    const r = await fetch(`https://www.omdbapi.com/?i=${id}&apikey=${encodeURIComponent(OMDB_KEY)}`).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!j) return;
    if (j.Response === 'False') {
      if (/limit|invalid api key/i.test(j.Error || '')) { stop = true; console.warn('  OMDb:', j.Error); }
      else cache[id] = {ts: now, i: null, r: null};
      return;
    }
    const rt = (j.Ratings || []).find(x => x.Source === 'Rotten Tomatoes')?.Value || null;
    cache[id] = {ts: now, i: j.imdbRating && j.imdbRating !== 'N/A' ? j.imdbRating : null, r: rt};
    done++;
  });
  log(`OMDb: ${done} notas atualizadas, ${missing.length - Math.min(missing.length, done)} ainda sem nota`);
}

/* ---------------- principal ---------------- */
async function main() {
  const t0 = Date.now();
  // 1. prêmios — se o Wikidata falhar ou vier incompleto, usa a cópia anterior
  const snapPath = path.join(CACHE, 'wikidata.json');
  const snap = await readJSON(snapPath, null);
  let wd = null;
  // Prêmios mudam pouco e o Wikidata é lento (mais de 1h na primeira coleta):
  // só reconsulta se a cópia tiver mais de WD_MAX_AGE_DAYS (padrão 7).
  const maxAge = +(process.env.WD_MAX_AGE_DAYS || 7) * DAY;
  if (snap && Date.now() - snap.ts < maxAge) { log(`Wikidata: cópia de ${new Date(snap.ts).toISOString().slice(0, 10)} ainda vale, pulando`); wd = snap.films; }
  else { try { wd = await loadWikidata(); } catch (e) { console.warn('Wikidata falhou:', e.message); wd = null; }
    if (wd && snap && wd.length < snap.films.length * 0.8) { console.warn(`Wikidata veio incompleto (${wd.length} vs ${snap.films.length}); usando a cópia anterior`); wd = null; }
    if (wd) await writeJSON(snapPath, {ts: Date.now(), films: wd}); }
  if (!wd && snap) wd = snap.films;
  if (!wd) throw new Error('Sem dados de prêmios: o Wikidata falhou e não há cópia anterior.');
  const byTmdb = new Map(wd.map(f => [f.tmdb, f]));

  // 2. streaming no Brasil para todos os filmes premiados/indicados
  let n = 0;
  await pool(wd, 20, async f => { f.rec = await movie(f.tmdb); if (++n % 1000 === 0) log(`TMDB: ${n}/${wd.length}`); });
  const films = wd.filter(f => f.rec?.ok).map(f => ({...f.rec, en: f.en, nf: f.nf, aw: f.aw,
    d: f.dirs.map(d => d.n).filter(Boolean), dk: f.dirs.map(d => d.t ? 't' + d.t : 'q' + d.q)}));
  log(`TMDB: ${films.length} de ${wd.length} disponíveis no Brasil`);

  // 3. diretores com mais prêmios e sua filmografia
  const idx = new Map();
  for (const f of wd) for (const d of f.dirs) {
    if (!d.n) continue;
    const k = d.t ? 't' + d.t : 'q' + d.q;
    let e = idx.get(k); if (!e) { e = {k, n: d.n, t: d.t, wins: 0, noms: 0, ff: 0, fa: 0}; idx.set(k, e); }
    e.wins += f.aw.filter(a => a.w).length; e.noms += f.aw.filter(a => !a.w).length; e.ff++; if (f.rec?.ok) e.fa++;
  }
  const top = [...idx.values()].sort((a, b) => b.wins - a.wins || b.noms - a.noms).slice(0, TOP_DIRECTORS);
  const extras = {}, festIds = new Set(films.map(f => f.id));
  await pool(top, 4, async d => {
    let id = d.t;
    if (!id) {
      const s = await tmdb('/search/person', {query: d.n});
      id = (s?.results?.find(p => p.known_for_department === 'Directing') || s?.results?.[0])?.id;
    }
    if (!id) return;
    const [p, cr] = await Promise.all([tmdb(`/person/${id}`, {language: 'pt-BR'}), tmdb(`/person/${id}/movie_credits`, {language: 'pt-BR'})]);
    let bio = p?.biography || (await tmdb(`/person/${id}`))?.biography || '';
    if (bio.length > 600) bio = bio.slice(0, 600).replace(/\s\S*$/, '') + '…';
    const seen = new Set();
    const list = (cr?.crew || []).filter(m => m.job === 'Director' && !seen.has(m.id) && seen.add(m.id))
      .sort((a, b) => (b.release_date || '0').localeCompare(a.release_date || '0'));
    d.id = id; d.ph = p?.profile_path || null; d.bio = bio; d.films = list.map(m => m.id);
    for (const m of list) {
      if (festIds.has(m.id) || extras[m.id]) continue;
      const rec = await movie(m.id), wf = byTmdb.get(m.id);
      extras[m.id] = rec
        ? {...rec, en: wf?.en || null, nf: wf?.nf || null, aw: wf?.aw || [], d: [d.n]}
        : {id: m.id, ok: 0, t: m.title, ot: m.original_title, y: m.release_date ? +m.release_date.slice(0, 4) : null, p: m.poster_path || null, ov: m.overview || '', aw: wf?.aw || [], d: [d.n], prov: {}};
    }
  });
  const directors = top.filter(d => d.id).map(({t, ...d}) => d);
  log(`Diretores: ${directors.length}, ${Object.keys(extras).length} filmes extras`);

  // 4. notas IMDb / Rotten Tomatoes, aos poucos, dentro da cota diária
  const omdbPath = path.join(CACHE, 'omdb.json');
  const omdb = await readJSON(omdbPath, {});
  const order = [...films].sort((a, b) => (b.y || 0) - (a.y || 0)).map(f => f.imdb)
    .concat(Object.values(extras).filter(f => f.ok).map(f => f.imdb)).filter(Boolean);
  await refreshRatings(omdb, [...new Set(order)]);
  await writeJSON(omdbPath, omdb);
  const rate = f => { const o = f.imdb && omdb[f.imdb]; if (o) { f.im = o.i; f.rot = o.r; } return f; };
  films.forEach(rate); Object.values(extras).forEach(rate);

  // 5. trava de segurança: não sobrescreve um catálogo bom com um quebrado
  const prev = await readJSON(path.join(OUT, 'filmes.json'), null);
  if (prev && films.length < prev.films.length * 0.5) throw new Error(`Só ${films.length} filmes (antes ${prev.films.length}); mantendo os dados anteriores.`);
  const updated = new Date().toISOString();
  await writeJSON(path.join(OUT, 'filmes.json'), {updated, films});
  await writeJSON(path.join(OUT, 'diretores.json'), {updated, directors, extras});
  log(`Pronto em ${Math.round((Date.now() - t0) / 1000)}s`);
}
main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
