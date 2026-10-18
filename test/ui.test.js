import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Element extends EventTarget {
  constructor(tag = 'div') {
    super();
    this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.dataset = {};
    this.hidden = false; this.textContent = ''; this.className = ''; this.value = ''; this.currentTime = 0;
    this.duration = NaN; this.readyState = 0; this.paused = true; this.playCount = 0; this.src = ''; this.loadedSources = [];
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      toggle: (name, force) => {
        const classes = new Set(this.className.split(' ').filter(Boolean));
        if (force ?? !classes.has(name)) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' ');
      },
      add: name => this.classList.toggle(name, true),
      remove: name => this.classList.toggle(name, false)
    };
  }
  append(...children) { for (const child of children) { child.remove(); child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
  setAttribute(name, value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); this.parent = null; }
  matches(selector) { return selector.startsWith('.') ? selector.slice(1).split('.').every(name => this.classList.contains(name)) : this.tagName.toLowerCase() === selector; }
  closest(selector) { for (let element = this; element; element = element.parent) if (element.matches(selector)) return element; return null; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  cloneNode() { const clone = new Element(this.tagName); Object.assign(clone, { id: this.id, hidden: this.hidden, src: this.src }); return clone; }
  get options() { return this.children; }
  load() { this.loadedSources.push(this.src); this.readyState = 0; this.currentTime = 0; this.duration = NaN; this.paused = true; }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  play() { this.playCount++; this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  canPlayType() { return 'probably'; }
  emit(name) { this.dispatchEvent(new Event(name)); }
}

const recording = {
  id: '586796', title: 'Processo Massimo Carminati ed altri', duration: null,
  tracks: [0, 1, 2].map(index => ({ index, title: 'Titolo ripetuto', m3u8: `https://example.org/${index + 1}.m3u8`, audio: true, subtitles: [] })),
  speakers: [
    { name: 'Sabrina Lorenzo', role: 'presidente del Collegio', offset: 0, durationSeconds: 336, fileIndex: 0 },
    { name: 'Gennaro Varone', role: 'pubblico ministero', offset: 336, durationSeconds: 300, fileIndex: 0 },
    { name: 'Maria Rossi', role: 'avvocato di Massimo Carminati', offset: 90, durationSeconds: 90, fileIndex: 1 },
    { name: 'Luca Bianchi', role: 'difensore', offset: 180, durationSeconds: 120, fileIndex: 1 },
    { name: 'Anna Verdi', offset: 20, durationSeconds: 60, fileIndex: 2 }
  ],
  topics: [], canonicalUrl: 'https://www.radioradicale.it/scheda/586796'
};

async function setup({ hls = true, data = recording, searchData = null, search = '?id=586796', navigator: browserNavigator = {}, baseUrl = 'http://localhost:3000' } = {}) {
  const ids = new Map();
  const body = new Element('body');
  const root = new Element('html'); root.append(body);
  const html = readFileSync(new URL('../src/ui/index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"/gi)) {
    const element = new Element(match[1]); element.id = match[2]; ids.set(element.id, element); body.append(element);
  }
  const element = id => { assert.ok(ids.has(id), `Missing element ${id}`); return ids.get(id); };
  const shell = new Element(); shell.className = 'media-shell'; body.append(shell);
  shell.append(element('media-video'), element('media-audio'));
  const document = Object.assign(new EventTarget(), { body, documentElement: root, readyState: 'complete', getElementById: element, createElement: tag => new Element(tag), querySelectorAll: selector => body.querySelectorAll(selector) });

  class Plyr {
    static instances = [];
    constructor(media) {
      this.media = media; this.original = media.cloneNode(true); Plyr.instances.push(this);
      this.wrapper = new Element(); this.wrapper.className = 'plyr';
      const parent = media.parent; media.remove(); parent.append(this.wrapper); this.wrapper.append(media);
      const progress = new Element(); progress.className = 'plyr__progress'; this.wrapper.append(progress);
      const seek = new Element('input'); seek.type = 'range'; seek.value = '0'; progress.append(seek);
      this.elements = { inputs: { seek } };
    }
    on(name, callback) { this.wrapper.addEventListener(name, callback); }
    destroy() {
      // Plyr 3.7.8 restores a clone, so listeners on this.media do not survive destroy().
      const parent = this.wrapper.parent;
      this.wrapper.remove(); parent.append(this.original); ids.set(this.original.id, this.original);
    }
  }
  class Hls {
    static instances = [];
    static isSupported() { return hls; }
    static Events = { MANIFEST_PARSED: 'manifest', LEVEL_LOADED: 'level', ERROR: 'error' };
    constructor(options) { this.options = options; this.handlers = new Map(); Hls.instances.push(this); }
    attachMedia(media) { this.media = media; media.src = 'blob:test'; }
    loadSource(source) { this.source = source; }
    on(name, callback) { this.handlers.set(name, callback); }
    destroy() { this.destroyed = true; }
    emit(name, data) { this.handlers.get(name)?.(name, data); }
    metadata(duration = 700) { this.media.readyState = 1; this.media.duration = duration; this.media.emit('loadedmetadata'); }
  }
  const requests = [];
  const addresses = [];
  const context = {
    window: { Plyr, Hls }, document, URL, URLSearchParams, setTimeout,
    location: { href: `${baseUrl}/${search}`, search },
    history: { replaceState(_state, _title, address) { addresses.push(address); } }, navigator: browserNavigator,
    fetch: async url => {
      requests.push(url);
      return { ok: true, json: async () => url.includes('/api/scheda/') ? data : searchData ? searchData(url) : { query: 'giustizia', type: 'general', results: [{ id: data.id, title: data.title }], count: 1, pagination: {}, related: [] } };
    }
  };
  vm.runInNewContext(readFileSync(new URL('../src/ui/theme.js', import.meta.url), 'utf8'), context);
  vm.runInNewContext(readFileSync(new URL('../src/ui/speaker-timeline.js', import.meta.url), 'utf8'), context);
  vm.runInNewContext(readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('player-status').classList.contains('error'), false, element('player-status').textContent);
  return { element, root, Plyr, Hls, requests, addresses, audio: element('media-audio'), video: element('media-video'), clickSpeaker: index => element('speakers').children[index].emit('click') };
}

test('player labels tracks and interventions and follows playback after reopening a search result', async () => {
  const { element, audio, Plyr, Hls } = await setup();
  assert.equal(element('loaded-player').hidden, false);
  assert.equal(audio.hidden, false);
  assert.equal(element('media-video').hidden, true);
  assert.deepEqual(element('track-select').options.map(option => option.textContent), ['Audio 1', 'Audio 2', 'Audio 3']);
  assert.equal(element('player-kind').textContent, 'Audio 1 di 3');
  assert.equal(element('speaker-now-name').textContent, 'Sabrina Lorenzo');
  assert.match(element('speaker-now-meta').textContent, /presidente del Collegio/);
  assert.equal(audio.closest('.plyr').querySelectorAll('.speaker-marker').length, 2);
  assert.equal(element('speakers').children[2].querySelector('.speaker-track').textContent, 'Audio 2');
  assert.equal(audio.playCount, 0);
  element('results').children[0].emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(element('media-audio'), audio, 'the media element and its listeners must survive source changes');
  assert.equal(Plyr.instances.length, 1);
  const stream = Hls.instances.at(-1);
  stream.emit('manifest'); stream.metadata();
  assert.equal(audio.playCount, 1);
  audio.currentTime = 340; audio.emit('timeupdate');
  assert.equal(element('speaker-now-name').textContent, 'Gennaro Varone');
  assert.equal(element('speakers').children[1].classList.contains('active'), true);
  audio.currentTime = 10; audio.emit('seeked');
  assert.equal(element('speaker-now-name').textContent, 'Sabrina Lorenzo');
});

test('clicking an intervention changes the playing source, waits for metadata, seeks, and updates the speaker', async () => {
  const { element, audio, Hls, clickSpeaker } = await setup();
  const first = Hls.instances.at(-1); first.emit('manifest'); first.metadata();
  await audio.play();
  clickSpeaker(2);
  const second = Hls.instances.at(-1);
  assert.equal(first.destroyed, true);
  assert.equal(second.source, recording.tracks[1].m3u8);
  assert.equal(second.media, audio);
  assert.equal(second.options.startPosition, 90);
  assert.equal(element('track-select').value, '1');
  assert.equal(element('player-kind').textContent, 'Audio 2 di 3');
  assert.equal(element('media-link').href, recording.tracks[1].m3u8);
  assert.equal(element('speaker-now-name').textContent, 'Maria Rossi');
  assert.match(element('speaker-now-meta').textContent, /Audio 2.*avvocato di Massimo Carminati/);
  second.emit('manifest');
  assert.equal(audio.playCount, 1, 'do not play the new source before its intervention seek can be applied');
  second.metadata();
  assert.equal(audio.currentTime, 90);
  assert.equal(audio.playCount, 2);
  assert.equal(audio.paused, false);
  audio.currentTime = 185; audio.emit('timeupdate');
  assert.equal(element('speaker-now-name').textContent, 'Luca Bianchi');
  assert.equal(element('speakers').children[3].classList.contains('active'), true);
  clickSpeaker(2);
  assert.equal(Hls.instances.at(-1), second, 'seeking within the same track should preserve the stream');
  assert.equal(audio.currentTime, 90);
  assert.equal(element('speaker-now-name').textContent, 'Maria Rossi');
});

test('rapid intervention changes discard old stream events and old pending seeks', async () => {
  const { audio, element, Hls, clickSpeaker } = await setup();
  clickSpeaker(4);
  const abandoned = Hls.instances.at(-1);
  clickSpeaker(2);
  const current = Hls.instances.at(-1);
  assert.equal(abandoned.destroyed, true);
  abandoned.emit('manifest');
  assert.equal(audio.playCount, 0);
  current.metadata();
  assert.equal(audio.currentTime, 90);
  assert.equal(audio.playCount, 0, 'metadata alone must not start an HLS stream before its manifest');
  current.emit('manifest');
  assert.equal(audio.playCount, 1);
  abandoned.emit('manifest'); audio.emit('loadedmetadata');
  assert.equal(audio.currentTime, 90);
  assert.equal(audio.playCount, 1);
  assert.equal(element('speaker-now-name').textContent, 'Maria Rossi');
});

test('intervention seeks also work with native HLS playback', async () => {
  const { audio, element, clickSpeaker } = await setup({ hls: false });
  clickSpeaker(2);
  assert.equal(audio.src, recording.tracks[1].m3u8);
  assert.equal(audio.loadedSources.at(-1), recording.tracks[1].m3u8);
  assert.equal(audio.preload, 'auto');
  assert.equal(audio.playCount, 0);
  audio.readyState = 1; audio.duration = 300; audio.emit('loadedmetadata');
  assert.equal(audio.currentTime, 90);
  assert.equal(audio.playCount, 1);
  audio.currentTime = 200; audio.emit('timeupdate');
  assert.equal(element('speaker-now-name').textContent, 'Luca Bianchi');
});

test('track menu and automatic handoff select and play the numbered track', async () => {
  const { audio, element, Hls } = await setup();
  Hls.instances.at(-1).metadata();
  audio.currentTime = 636; audio.emit('ended');
  assert.equal(element('track-select').value, '1');
  assert.equal(element('player-kind').textContent, 'Audio 2 di 3');
  assert.equal(Hls.instances.at(-1).source, recording.tracks[1].m3u8);
  Hls.instances.at(-1).emit('manifest');
  assert.equal(audio.playCount, 1);
  element('track-select').value = '2'; element('track-select').emit('change');
  assert.equal(Hls.instances.at(-1).source, recording.tracks[2].m3u8);
  Hls.instances.at(-1).emit('manifest');
  assert.equal(audio.playCount, 2);
  assert.equal(element('player-kind').textContent, 'Audio 3 di 3');
});

test('switching between audio and video preserves both players and hides the inactive controls', async () => {
  const data = structuredClone(recording); data.tracks[2].audio = false;
  const { audio, video, element, Plyr, Hls, clickSpeaker } = await setup({ data });
  clickSpeaker(4);
  const stream = Hls.instances.at(-1); stream.emit('manifest'); stream.metadata();
  assert.equal(element('media-video'), video);
  assert.equal(video.currentTime, 20);
  assert.equal(video.paused, false);
  assert.equal(audio.closest('.plyr').hidden, true);
  assert.equal(video.closest('.plyr').hidden, false);
  clickSpeaker(2);
  Hls.instances.at(-1).emit('manifest'); Hls.instances.at(-1).metadata();
  assert.equal(element('media-audio'), audio);
  assert.equal(audio.currentTime, 90);
  assert.equal(audio.closest('.plyr').hidden, false);
  assert.equal(video.closest('.plyr').hidden, true);
  assert.equal(Plyr.instances.length, 2);
  audio.currentTime = 190; audio.emit('timeupdate');
  assert.equal(element('speaker-now-name').textContent, 'Luca Bianchi');
});

test('intervention filter matches names, roles, and track numbers without changing playback', async () => {
  const { element, audio, Hls } = await setup();
  const stream = Hls.instances.at(-1);
  const rows = element('speakers').children;
  element('speaker-filter').value = 'avvocato audio 2'; element('speaker-filter').emit('input');
  assert.deepEqual(rows.filter(row => !row.hidden).map(row => row.dataset.offset), ['90']);
  assert.equal(element('speaker-count').textContent, '1 di 5');
  element('speaker-filter').value = 'nessuno'; element('speaker-filter').emit('input');
  assert.equal(element('speaker-filter-empty').hidden, false);
  element('speaker-filter').value = 'PÚBBLICO'; element('speaker-filter').emit('input');
  assert.equal(rows[1].hidden, false);
  element('speaker-filter').value = ''; element('speaker-filter').emit('input');
  assert.equal(rows.filter(row => !row.hidden).length, 5);
  assert.equal(element('speaker-filter-empty').hidden, true);
  assert.equal(Hls.instances.at(-1), stream);
  assert.equal(audio.playCount, 0);
});

test('skip buttons preserve pause state, clamp positions, and retain playback speed across tracks', async () => {
  const { element, audio, Hls, clickSpeaker } = await setup();
  const stream = Hls.instances.at(-1); stream.emit('manifest'); stream.metadata(636);
  audio.currentTime = 100; element('skip-forward').emit('click');
  assert.equal(audio.currentTime, 115);
  assert.equal(audio.paused, true);
  assert.equal(audio.playCount, 0);
  audio.currentTime = 5; element('skip-back').emit('click');
  assert.equal(audio.currentTime, 0);
  audio.currentTime = 630; element('skip-forward').emit('click');
  assert.equal(audio.currentTime, 636);
  element('playback-speed').value = '1.5'; element('playback-speed').emit('change');
  assert.equal(audio.playbackRate, 1.5);
  clickSpeaker(2);
  const next = Hls.instances.at(-1); next.emit('manifest'); next.metadata();
  assert.equal(audio.playbackRate, 1.5);
  assert.equal(element('playback-speed').value, '1.5');
  assert.equal(audio.currentTime, 90);
  element('skip-forward').emit('click');
  assert.equal(audio.currentTime, 105);
  assert.equal(audio.paused, false);
});

test('mobile player bar pauses and resumes audio while keeping search open', async () => {
  const { element, audio, Hls } = await setup();
  const stream = Hls.instances.at(-1); stream.emit('manifest'); stream.metadata();
  const body = audio.closest('body');
  element('tab-search').emit('click');
  assert.equal(body.classList.contains('view-player'), false);
  element('mini-toggle').emit('click');
  assert.equal(audio.paused, false);
  assert.equal(element('mini-toggle').textContent, 'Pausa');
  assert.equal(body.classList.contains('view-player'), false);
  element('mini-toggle').emit('click');
  assert.equal(audio.paused, true);
  assert.equal(element('mini-toggle').textContent, 'Riproduci');
  element('mini-open').emit('click');
  assert.equal(body.classList.contains('view-player'), true);
});

test('scrubbing previews time and speaker without playback updates overwriting the chosen position', async () => {
  const { audio, element, Plyr, Hls } = await setup();
  assert.equal(element('seek-submit').disabled, true, 'a guessed duration must not enable exact seeking');
  const stream = Hls.instances.at(-1); stream.emit('manifest'); stream.metadata(700);
  const slider = Plyr.instances[0].elements.inputs.seek;
  audio.currentTime = 10; audio.emit('timeupdate');
  slider.value = '50'; slider.emit('input');
  assert.equal(element('seek-preview').textContent, 'Vai a 05:50 · Gennaro Varone');
  assert.equal(element('seek-remaining').textContent, '05:50 rimanenti');
  audio.currentTime = 20; audio.emit('timeupdate');
  assert.equal(element('seek-preview').textContent, 'Vai a 05:50 · Gennaro Varone');
  slider.emit('change');
  assert.equal(element('seek-preview').textContent, '00:20 · Sabrina Lorenzo');
  assert.equal(audio.paused, true);
});

test('minute and second seeking is precise and preserves playing or paused state', async () => {
  const { audio, element, Hls } = await setup();
  const stream = Hls.instances.at(-1); stream.emit('manifest'); stream.metadata(700);
  element('seek-minutes').value = '5'; element('seek-seconds').value = '40'; element('seek-form').emit('submit');
  assert.equal(audio.currentTime, 340);
  assert.equal(audio.paused, true);
  assert.equal(audio.playCount, 0);
  assert.equal(element('speaker-now-name').textContent, 'Gennaro Varone');
  assert.equal(element('seek-remaining').textContent, '06:00 rimanenti');
  await audio.play();
  element('seek-minutes').value = '0'; element('seek-seconds').value = '20'; element('seek-form').emit('submit');
  assert.equal(audio.currentTime, 20);
  assert.equal(audio.paused, false);
  assert.equal(element('speaker-now-name').textContent, 'Sabrina Lorenzo');
  assert.equal(Hls.instances.at(-1), stream);
});

test('invalid exact seek times leave playback untouched and reset when changing tracks', async () => {
  const { audio, element, Hls, clickSpeaker } = await setup();
  Hls.instances.at(-1).metadata(700);
  audio.currentTime = 25;
  for (const [minutes, seconds] of [['', ''], ['1', '60'], ['-1', '0'], ['1.5', '0'], ['20', '0']]) {
    element('seek-minutes').value = minutes; element('seek-seconds').value = seconds; element('seek-form').emit('submit');
    assert.equal(element('seek-error').hidden, false);
    assert.equal(audio.currentTime, 25);
    assert.equal(audio.playCount, 0);
  }
  element('seek-minutes').emit('input');
  assert.equal(element('seek-error').textContent, '');
  clickSpeaker(2);
  assert.equal(element('seek-minutes').value, '');
  assert.equal(element('seek-seconds').value, '');
  assert.equal(element('seek-error').hidden, true);
  assert.equal(element('seek-submit').disabled, true);
});

test('intervention buttons group speakers at one point and remain separate from the slider', async () => {
  const data = structuredClone(recording);
  data.speakers.push({ name: 'Altro oratore', offset: 336, durationSeconds: 300, fileIndex: 0 });
  const { audio, element, Hls } = await setup({ data });
  const stream = Hls.instances.at(-1); stream.emit('manifest'); stream.metadata();
  const chapters = element('timeline-chapters');
  assert.equal(chapters.children.length, 2);
  const selected = chapters.children[1];
  assert.equal(selected.querySelector('.chapter-name').textContent, 'Gennaro Varone, Altro oratore');
  selected.emit('click');
  assert.equal(audio.currentTime, 336);
  assert.equal(audio.paused, false);
  assert.equal(selected.classList.contains('active'), true);
  assert.equal(chapters.children[1], selected, 'clock updates must not recreate the scrollable chapter buttons');
  assert.equal(audio.closest('.plyr').querySelector('.speaker-marker').tagName, 'SPAN');
});

function searchPageFixture(url) {
  const parsed = new URL(url, 'http://localhost:3000');
  const page = Number(parsed.searchParams.get('page') || 0);
  const subject = parsed.pathname.startsWith('/api/soggetti/');
  const results = Array.from({ length: 15 }, (_, index) => ({ id: String(50000 + page * 15 + index), title: `Risultato ${page * 15 + index + 1}` }));
  return { query: subject ? '86/marco-pannella' : parsed.searchParams.get('q'), type: subject ? 'soggetti' : 'general', results, count: results.length,
    pagination: { currentPage: page, totalPages: 3, totalPagesKnown: true, hasPrev: page > 0, hasNext: page < 2 }, related: [] };
}

test('search renders more than ten results and browses pages while retaining the query in the address', async () => {
  const { element, requests, addresses } = await setup({ search: '?q=giustizia', searchData: searchPageFixture });
  assert.equal(element('results').children.length, 15);
  assert.equal(element('prev-page').disabled, true);
  assert.equal(element('next-page').disabled, false);
  assert.equal(element('pagination').hidden, false);
  element('next-page').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.at(-1), '/api/search?q=giustizia&page=1');
  assert.equal(element('results').children[0].querySelector('.result-title').textContent, 'Risultato 16');
  const address = new URL(addresses.at(-1), 'http://localhost:3000');
  assert.equal(address.searchParams.get('q'), 'giustizia');
  assert.equal(address.searchParams.get('page'), '2');
  element('page-number').value = '3'; element('page-form').emit('submit');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.at(-1), '/api/search?q=giustizia&page=2');
  assert.equal(element('page-label').textContent, 'Pagina 3 di 3');
  assert.equal(element('next-page').disabled, true);
  const count = requests.length;
  element('next-page').emit('click');
  assert.equal(requests.length, count);
  element('prev-page').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.at(-1), '/api/search?q=giustizia&page=1');
  element('results').children[0].emit('click');
  await new Promise(resolve => setImmediate(resolve));
  const recordingAddress = new URL(addresses.at(-1), 'http://localhost:3000');
  assert.equal(recordingAddress.searchParams.get('page'), '2');
  assert.equal(recordingAddress.searchParams.get('q'), 'giustizia');
  assert.equal(recordingAddress.searchParams.get('id'), recording.id);
});

test('a shared search page reloads the same results and subject pagination preserves its path', async () => {
  const general = await setup({ search: '?q=giustizia&page=3', searchData: searchPageFixture });
  assert.equal(general.requests[0], '/api/search?q=giustizia&page=2');
  assert.equal(general.element('page-label').textContent, 'Pagina 3 di 3');
  const subject = await setup({ search: '?subject=86%2Fmarco-pannella&page=2', searchData: searchPageFixture });
  assert.equal(subject.requests[0], '/api/soggetti/86/marco-pannella?page=1');
  subject.element('next-page').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(subject.requests.at(-1), '/api/soggetti/86/marco-pannella?page=2');
  const address = new URL(subject.addresses.at(-1), 'http://localhost:3000');
  assert.equal(address.searchParams.get('subject'), '86/marco-pannella');
  assert.equal(address.searchParams.get('page'), '3');
});

test('unknown total page counts never impose a ten-page limit or a false last-page label', async () => {
  const searchData = url => ({ ...searchPageFixture(url), pagination: { currentPage: Number(new URL(url, 'http://localhost:3000').searchParams.get('page')), totalPages: 2, totalPagesKnown: false, hasNext: true, hasPrev: true } });
  const { element, requests } = await setup({ search: '?q=giustizia', searchData });
  element('page-number').value = '11'; element('page-form').emit('submit');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.at(-1), '/api/search?q=giustizia&page=10');
  assert.equal(element('page-label').textContent, 'Pagina 11');
  assert.equal(element('page-number').max, undefined);
});

test('theme switching remains available in search and playback without restarting the stream', async () => {
  const { element, root, audio, Hls, requests } = await setup();
  const stream = Hls.instances.at(-1); stream.emit('manifest'); stream.metadata();
  await audio.play(); audio.currentTime = 340;
  const calls = requests.length;
  element('theme-toggle').emit('click');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(element('theme-toggle')['aria-checked'], 'true');
  element('tab-search').emit('click');
  element('theme-toggle').emit('click');
  assert.equal(root.dataset.theme, 'light');
  element('tab-player').emit('click');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(Hls.instances.at(-1), stream);
  assert.equal(audio.currentTime, 340);
  assert.equal(audio.paused, false);
  assert.equal(audio.playCount, 1);
  assert.equal(requests.length, calls);
});

test('native share uses the selected audio and optionally includes the current position', async () => {
  const shared = [];
  const { element, audio, Hls, clickSpeaker } = await setup({ baseUrl: 'https://archive.example', navigator: { share: async data => { shared.push(data); } } });
  clickSpeaker(2);
  const stream = Hls.instances.at(-1); stream.emit('manifest'); stream.metadata();
  element('share-recording').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  const first = new URL(shared[0].url);
  assert.equal(first.origin, 'https://archive.example');
  assert.equal(first.searchParams.get('id'), recording.id);
  assert.equal(first.searchParams.get('track'), '2');
  assert.equal(first.searchParams.has('q'), false);
  assert.equal(first.searchParams.has('t'), false);
  assert.equal(shared[0].title, recording.title);
  audio.currentTime = 125.9;
  element('share-position').checked = true; element('share-recording').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(new URL(shared[1].url).searchParams.get('t'), '125');
  assert.equal(audio.currentTime, 125.9);
  assert.equal(audio.paused, false);
  assert.equal(Hls.instances.at(-1), stream);
});

test('copy link and desktop share fallback copy a playable recording URL', async () => {
  const copied = [];
  const { element, audio } = await setup({ navigator: { clipboard: { writeText: async value => { copied.push(value); } } } });
  element('copy-recording').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(new URL(copied[0]).searchParams.get('track'), '1');
  assert.equal(new URL(copied[0]).searchParams.get('id'), recording.id);
  assert.equal(element('share-status').textContent, 'Link copiato.');
  audio.currentTime = 91; element('share-position').checked = true;
  element('share-recording').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(new URL(copied[1]).searchParams.get('t'), '91');
  assert.equal(audio.paused, true);
});

test('shared track and timestamp links restore the correct audio paused at the selected point', async () => {
  const { audio, element, Hls, addresses } = await setup({ search: '?id=586796&track=2&t=95' });
  const stream = Hls.instances.at(-1);
  assert.equal(stream.source, recording.tracks[1].m3u8);
  assert.equal(stream.options.startPosition, 95);
  assert.equal(element('track-select').value, '1');
  stream.emit('manifest'); stream.metadata();
  assert.equal(audio.currentTime, 95);
  assert.equal(audio.paused, true);
  assert.equal(audio.playCount, 0);
  assert.equal(element('speaker-now-name').textContent, 'Maria Rossi');
  const address = new URL(addresses.at(-1), 'http://localhost:3000');
  assert.equal(address.searchParams.get('track'), '2');
  assert.equal(address.searchParams.get('t'), '95');
});

test('shared timestamps work with native HLS and clamp to the track duration', async () => {
  const { audio } = await setup({ hls: false, search: '?id=586796&track=2&t=9999' });
  assert.equal(audio.src, recording.tracks[1].m3u8);
  audio.readyState = 1; audio.duration = 300; audio.emit('loadedmetadata');
  assert.equal(audio.currentTime, 300);
  assert.equal(audio.playCount, 0);
});

test('invalid shared playback parameters safely open the first audio track', async () => {
  const { audio, element, Hls } = await setup({ search: '?id=586796&track=999&t=NaN' });
  const stream = Hls.instances.at(-1);
  assert.equal(stream.source, recording.tracks[0].m3u8);
  stream.emit('manifest'); stream.metadata();
  assert.equal(element('track-select').value, '0');
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.paused, true);
});

test('blocked clipboard exposes a selectable link and canceling native share does not copy it', async () => {
  const blocked = await setup();
  blocked.element('copy-recording').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(blocked.element('share-url').hidden, false);
  assert.equal(blocked.element('share-url-label').hidden, false);
  assert.equal(new URL(blocked.element('share-url').value).searchParams.get('id'), recording.id);
  let copies = 0;
  const canceled = await setup({ navigator: {
    share: async () => { const error = new Error('Canceled'); error.name = 'AbortError'; throw error; },
    clipboard: { writeText: async () => { copies++; } }
  } });
  canceled.element('share-recording').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copies, 0);
  assert.equal(canceled.element('share-url').hidden, true);
  assert.equal(canceled.element('share-status').textContent, '');
});

test('live sharing opens the live stream and does not include an archive timestamp', async () => {
  const copied = [];
  const { element } = await setup({ navigator: { clipboard: { writeText: async value => { copied.push(value); } } } });
  element('live-button').emit('click');
  element('copy-recording').emit('click');
  await new Promise(resolve => setImmediate(resolve));
  const url = new URL(copied[0]);
  assert.equal(url.searchParams.get('live'), '1');
  assert.equal(url.searchParams.has('id'), false);
  assert.equal(url.searchParams.has('track'), false);
  assert.equal(url.searchParams.has('t'), false);
  assert.equal(element('share-position').disabled, true);
});
