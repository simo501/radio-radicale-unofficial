import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/server.js';
import { parseSearch, searchUrl } from '../src/services/search.js';
import { extractJsonObject, parseInterventionsFromMarkup, parseRecording } from '../src/services/extractor.js';
import { TTLCache } from '../src/core/cache.js';
import { gunzipSync } from 'node:zlib';

const searchFixture = `<ul><li class="clearfix"><a href="/scheda/12345/assemblea"><h3>Assemblea &amp; dibattito</h3></a><time datetime="2020-04-18">18 aprile 2020</time><span class="durata">1:20:00</span><img src="/files/thumb.jpg"></li><li class="clearfix"><a href="/scheda/12345/again">Duplicate</a></li></ul><nav class="pager"><a href="?page=1">2</a></nav><a href="/soggetti/86/marco-pannella">Marco Pannella</a>`;
const recordingFixture = `<html><head><meta property="og:image" content="/images/123.jpg"><link rel="canonical" href="https://www.radioradicale.it/scheda/12345/assemblea"></head><body><h1>Assemblea &amp; dibattito</h1><div class="summary">Una discussione &lt;pubblica&gt;.</div><script>jQuery.extend(Drupal.settings, {"RRscheda":{"playlist":[{"title":"Prima parte","audio":true,"sources":[{"file":"https://media.example.org/123/playlist.m3u8"}],"subtitles":[{"src":"https://media.example.org/sub.vtt","srclang":"it"}]}],"interventions":[{"id":1,"name":"Ada Rossi","offset":42,"fileIndex":0}]}});</script></body></html>`;

test('search parser keeps result shape, pagination and related terms', () => {
  const data = parseSearch(searchFixture, { query: 'assemblea', page: 0, searchUrl: searchUrl('assemblea') });
  assert.equal(data.count, 1);
  assert.equal(data.results[0].title, 'Assemblea & dibattito');
  assert.equal(data.results[0].dateIso, '2020-04-18');
  assert.equal(data.results[0].duration, '1:20:00');
  assert.equal(data.pagination.hasNext, true);
  assert.equal(data.related[0].text, 'Marco Pannella');
});

test('search pagination decodes escaped links and returns every result on the page', () => {
  const rows = Array.from({ length: 15 }, (_, index) => `<li class="clearfix"><a href="/scheda/${30000 + index}/titolo"><h3>Titolo ${index}</h3></a></li>`).join('');
  const html = `${rows}<nav class="pager"><a href="?search_api_views_fulltext=giustizia&amp;page=1">2</a><li class="pager-last"><a href="?search_api_views_fulltext=giustizia&#38;page=42">ultima pagina</a></li></nav>`;
  const result = parseSearch(html, { query: 'giustizia', searchUrl: searchUrl('giustizia') });
  assert.equal(result.count, 15);
  assert.equal(result.results.at(-1).id, '30014');
  assert.equal(result.pagination.hasNext, true);
  assert.equal(result.pagination.totalPages, 43);
  assert.equal(result.pagination.totalPagesKnown, true);
});

test('pagination does not treat a disabled next control or an unrelated page link as another result page', () => {
  const html = `<li class="clearfix"><a href="/scheda/30000/titolo">Titolo</a></li><nav class="pager"><a href="?q=test&amp;page=0">1</a><li class="pager-next"><span>successivi</span></li></nav><a href="/scheda/30000?page=99">altro</a>`;
  const result = parseSearch(html, { query: 'test', page: 1, searchUrl: searchUrl('test', 1) });
  assert.equal(result.pagination.hasNext, false);
  assert.equal(result.pagination.hasPrev, true);
  assert.equal(result.pagination.totalPages, 2);
  assert.equal(result.pagination.totalPagesKnown, true);
});

test('missing pager markup still allows browsing beyond a populated page until results end', () => {
  const options = { query: 'test', page: 2, searchUrl: searchUrl('test', 2) };
  const populated = parseSearch('<li class="clearfix"><a href="/scheda/30000/titolo">Titolo</a></li>', options);
  assert.equal(populated.pagination.hasNext, true);
  assert.equal(populated.pagination.totalPagesKnown, false);
  const empty = parseSearch('<p>Nessun risultato</p>', { ...options, page: 3 });
  assert.equal(empty.pagination.hasNext, false);
  assert.equal(empty.pagination.hasPrev, true);
});

test('recording parser extracts HLS, subtitles and speaker offsets', () => {
  const data = parseRecording(recordingFixture, 'https://www.radioradicale.it/scheda/12345');
  assert.equal(data.title, 'Assemblea & dibattito');
  assert.equal(data.summary, 'Una discussione <pubblica>.');
  assert.equal(data.tracks[0].m3u8, 'https://media.example.org/123/playlist.m3u8');
  assert.equal(data.tracks[0].subtitles[0].srclang, 'it');
  assert.equal(data.speakers[0].offset, 42);
  assert.equal(data.primaryM3u8, data.tracks[0].m3u8);
});

test('recording parser derives intervention offsets across a pause and two audio files', () => {
  const html = `<h1>Processo Massimo Carminati ed altri</h1><a>Interventi</a><a>Trascrizione automatica</a>
    <div>Appello e costituzione delle parti<h2>Sabrina Lorenzo</h2><p>presidente del Collegio</p><span>9:30 Durata: 7 min 1 sec</span></div>
    <div>Pausa <span>9:37 Durata: 39 min</span></div>
    <div>Prosegue la costituzione delle parti<h2>Sabrina Lorenzo</h2><p>presidente del Collegio</p><span>10:16 Durata: 5 min 36 sec</span></div>
    <div>Questioni preliminari<h2>Sabrina Lorenzo</h2><p>presidente del Collegio</p><h2>Gennaro Varone</h2><p>pubblico ministero</p><span>10:21 Durata: 10 min 5 sec</span></div>
    <div>Visualizza la trascrizione automatica</div>`;
  const speakers = parseInterventionsFromMarkup(html, 2);
  assert.deepEqual(speakers.map(item => [item.name, item.fileIndex, item.offset]), [
    ['Sabrina Lorenzo', 0, 0], ['Sabrina Lorenzo', 1, 0],
    ['Sabrina Lorenzo', 1, 336], ['Gennaro Varone', 1, 336]
  ]);
  assert.equal(speakers[0].durationSeconds, 421);
  assert.deepEqual(speakers.map(item => item.role), ['presidente del Collegio', 'presidente del Collegio', 'presidente del Collegio', 'pubblico ministero']);
  const fullPage = `${html}<script>jQuery.extend(Drupal.settings, {"RRscheda":{"playlist":[{"sources":["https://media.example.org/one.m3u8"]},{"sources":["https://media.example.org/two.m3u8"]}]}});</script>`;
  const recording = parseRecording(fullPage, 'https://www.radioradicale.it/scheda/586796');
  assert.equal(recording.speakers.length, 4);
  assert.equal(recording.speakers[2].fileIndex, 1);
});

test('intervention parser keeps relationship descriptions for the oratori list', () => {
  const html = `<h1>Udienza</h1><a>Interventi</a><div><h2>Maria Rossi</h2><p>avvocato di Massimo Carminati</p><span>9:30 Durata: 2 min</span></div><div><h2>Luca Bianchi</h2><p>difensore della parte civile</p><span>9:32 Durata: 1 min</span></div>`;
  assert.deepEqual(parseInterventionsFromMarkup(html, 1).map(item => item.role), ['avvocato di Massimo Carminati', 'difensore della parte civile']);
});

test('JSON extraction respects braces inside string values', () => {
  assert.deepEqual(extractJsonObject('prefix {"message":"a } b","nested":{"x":1}} tail', 0), { message: 'a } b', nested: { x: 1 } });
});

test('cache expires and evicts least recently used item', async () => {
  const cache = new TTLCache(30, 2);
  cache.set('a', 1); cache.set('b', 2); cache.get('a'); cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(cache.get('a'), undefined);
});

async function request(url, method = 'GET', headers = {}) {
  const req = { method, url, headers: { host: 'localhost', ...headers } };
  const res = {
    status: null, headers: {}, body: '', headersSent: false,
    writeHead(status, outgoing) { this.status = status; this.headers = outgoing; this.headersSent = true; },
    end(body) { this.bytes = body || Buffer.alloc(0); this.body = body?.toString() || ''; }
  };
  await handleRequest(req, res);
  return res;
}

test('HTTP handler returns static UI, docs, method errors and valid headers', async () => {
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /id="search-form"/);
  assert.equal((await request('/ui/app.js')).status, 200);
  for (const path of ['/docs', '/api-docs']) {
    const docs = await request(path);
    assert.equal(docs.status, 200);
    assert.match(docs.body, /id="theme-toggle"/);
    assert.match(docs.body, /src="\/ui\/theme.js"/);
  }
  const theme = await request('/ui/theme.js');
  assert.equal(theme.status, 200);
  assert.match(theme.body, /rr-theme/);

  const head = await request('/api/live', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal((await request('/api/live/stream')).headers.Location, 'https://live.radioradicale.it/live.mp3');
  assert.equal((await request('/api/search')).status, 400);
  assert.equal((await request('/api/search?q=x&page=-1')).status, 400);
  assert.equal((await request('/api/search?q=x&type=other')).status, 400);
  assert.equal((await request('/api/soggetti/%ZZ')).status, 400);
  assert.equal((await request('/api/scheda?url=http://127.0.0.1/')).status, 400);
  assert.equal((await request('/api/scheda/abc')).status, 400);
  assert.equal((await request('/api/m3u8/123?track=-1')).status, 400);
  assert.equal((await request('/', 'POST')).status, 405);
  assert.equal((await request('/does-not-exist')).status, 404);
  assert.equal((await request('/api/live', 'OPTIONS')).status, 204);
});

test('fixture upstream routes share cache and select HLS tracks', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(recordingFixture, { status: 200, headers: { 'content-type': 'text/html' } }); };
  try {
    const detail = await request('/api/scheda/987654');
    assert.equal(detail.status, 200);
    assert.equal(detail.headers['X-Cache'], 'MISS');
    assert.equal(JSON.parse(detail.body).tracks[0].m3u8, 'https://media.example.org/123/playlist.m3u8');
    const redirect = await request('/api/m3u8/987654');
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.Location, 'https://media.example.org/123/playlist.m3u8');
    assert.equal(redirect.headers['X-Cache'], 'HIT');
    const stream = await request('/api/stream/987654?redirect=false');
    assert.equal(JSON.parse(stream.body).trackIndex, 0);
    assert.equal(calls, 1);
    assert.equal((await request('/api/m3u8/987654?track=1')).status, 404);
  } finally { globalThis.fetch = originalFetch; }
});

test('gzip is applied to large JSON and HEAD sends no body', async () => {
  const originalFetch = globalThis.fetch;
  const largeFixture = Array.from({ length: 18 }, (_, i) => searchFixture.replaceAll('12345', String(20000 + i))).join('');
  globalThis.fetch = async () => new Response(largeFixture, { status: 200 });
  try {
    const result = await request('/api/search?q=fixture-long-result', 'GET', { 'accept-encoding': 'gzip' });
    assert.equal(result.status, 200);
    assert.equal(result.headers['Content-Encoding'], 'gzip');
    assert.equal(JSON.parse(gunzipSync(result.bytes).toString()).count, 18);
    const head = await request('/api/search?q=fixture-long-result', 'HEAD', { 'accept-encoding': 'gzip' });
    assert.equal(head.headers['Content-Encoding'], 'gzip');
    assert.equal(head.bytes.length, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('search API fetches and caches result pages independently', async () => {
  const originalFetch = globalThis.fetch;
  const pages = [];
  globalThis.fetch = async input => {
    const url = new URL(input);
    const page = Number(url.searchParams.get('page') || 0);
    pages.push(page);
    const row = `<li class="clearfix"><a href="/scheda/${40000 + page}/titolo"><h3>Pagina ${page + 1}</h3></a></li>`;
    return new Response(`${row}<nav class="pager"><a href="?q=fixture-pages&amp;page=0">1</a>${page < 2 ? `<a href="?q=fixture-pages&amp;page=${page + 1}">successivi</a>` : ''}</nav>`);
  };
  try {
    for (const page of [0, 1, 2]) {
      const response = await request(`/api/search?q=fixture-pages&page=${page}`);
      assert.equal(response.status, 200);
      const result = JSON.parse(response.body);
      assert.equal(result.results[0].id, String(40000 + page));
      assert.equal(result.pagination.currentPage, page);
      assert.equal(result.pagination.hasNext, page < 2);
    }
    assert.equal((await request('/api/search?q=fixture-pages&page=1')).headers['X-Cache'], 'HIT');
    assert.deepEqual(pages, [0, 1, 2]);
  } finally { globalThis.fetch = originalFetch; }
});

test('upstream redirects outside the recording path are rejected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: 'https://www.radioradicale.it/cerca' } });
  try {
    const result = await request('/api/scheda/876543');
    assert.equal(result.status, 502);
    assert.match(JSON.parse(result.body).error, /unexpected page/);
  } finally { globalThis.fetch = originalFetch; }
});
