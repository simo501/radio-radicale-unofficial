(() => {
  const $ = id => document.getElementById(id);
  const timeline = window.SpeakerTimeline;
  const state = { query: '', page: 0, type: 'general', pagination: null, recording: null, track: 0, live: false, rate: 1, hls: null, plyr: null, playback: null, timelineDuration: null, scrubTime: null, chapterSignature: null, searchToken: 0, detailToken: 0 };
  const players = new Map();
  const boundSliders = new WeakSet();
  const playbackRates = [0.75, 1, 1.25, 1.5, 2];
  let media = $('media-video');
  const safeUrl = value => { try { const url = new URL(value, location.href); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
  const node = (tag, className, value) => { const element = document.createElement(tag); if (className) element.className = className; if (value !== undefined) element.textContent = value; return element; };
  const setStatus = (id, message, error = false) => { $(id).textContent = message; $(id).classList.toggle('error', error); };
  const formatTime = seconds => { const n = Math.max(0, Math.floor(Number(seconds) || 0)); return `${Math.floor(n / 3600) ? `${Math.floor(n / 3600)}:` : ''}${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
  const trackLabel = index => `${state.recording?.tracks?.[index]?.audio ? 'Audio' : 'Video'} ${index + 1}`;

  function showTab(name) {
    document.body.classList.toggle('view-player', name === 'player');
    for (const section of ['search', 'player']) {
      const selected = section === name;
      $(`tab-${section}`).classList.toggle('active', selected);
      $(`tab-${section}`).setAttribute('aria-selected', String(selected));
    }
  }

  function searchParameters() {
    const params = new URLSearchParams();
    if (state.query) params.set(state.type === 'soggetti' ? 'subject' : 'q', state.query);
    if (state.page > 0) params.set('page', String(state.page + 1));
    return params;
  }

  async function json(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    let data;
    try { data = await response.json(); } catch { throw new Error('Risposta non valida dal server.'); }
    if (!response.ok) throw new Error(data.error || `Errore ${response.status}`);
    return data;
  }

  function renderResults(data) {
    const list = $('results');
    list.replaceChildren();
    $('result-heading').textContent = data.type === 'soggetti' ? 'Registrazioni' : `Risultati per “${data.query}”`;
    if (!data.results.length) setStatus('search-status', state.page > 0 ? 'Nessun altro risultato in questa pagina. Torna alla pagina precedente.' : 'Nessun risultato. Prova un’altra ricerca.');
    else setStatus('search-status', `${data.count} ${data.count === 1 ? 'risultato' : 'risultati'} in questa pagina`);
    for (const item of data.results) {
      const card = node('button', 'result-card'); card.type = 'button';
      card.setAttribute('aria-label', `Apri ${item.title || 'registrazione'}`);
      const body = node('span', 'result-body');
      const top = node('span', 'result-top');
      top.append(node('span', '', item.mediaType || 'Archivio'));
      if (item.date) { top.append(node('span', 'dot', '•'), node('span', '', item.date)); }
      body.append(top, node('strong', 'result-title', item.title || `Registrazione ${item.id}`));
      const meta = [item.category, item.location, item.duration].filter(Boolean).join(' · ');
      if (meta) body.append(node('span', 'result-meta', meta));
      card.append(body);
      card.addEventListener('click', () => { document.querySelectorAll('.result-card.selected').forEach(el => el.classList.remove('selected')); card.classList.add('selected'); openRecording(item.id, true); });
      list.append(card);
    }
    const pagination = data.pagination || {};
    state.pagination = pagination;
    $('pagination').hidden = !(pagination.hasNext || pagination.hasPrev);
    $('prev-page').disabled = !pagination.hasPrev;
    $('next-page').disabled = !pagination.hasNext;
    $('page-label').textContent = `Pagina ${(pagination.currentPage ?? state.page) + 1}${pagination.totalPagesKnown ? ` di ${pagination.totalPages}` : ''}`;
    $('page-number').value = String((pagination.currentPage ?? state.page) + 1);
    if (pagination.totalPagesKnown) $('page-number').max = String(pagination.totalPages);
    else $('page-number').removeAttribute('max');
    const related = $('related-links'); related.replaceChildren();
    for (const item of (data.related || []).filter(item => item.text).slice(0, 12)) {
      const path = item.href?.match(/^\/soggetti\/(\d+(?:\/[a-z0-9-]+)?)/i)?.[1];
      if (!path) continue;
      const button = node('button', '', item.text); button.type = 'button';
      button.addEventListener('click', () => search(path, 0, 'soggetti'));
      related.append(button);
    }
    $('related-section').hidden = !related.children.length;
  }

  async function search(query, page = 0, type = 'general', updateHistory = true, scrollResults = false) {
    state.query = query.trim(); state.page = page; state.type = type;
    const token = ++state.searchToken;
    $('search-input').value = type === 'general' ? state.query : '';
    $('results').replaceChildren(); $('pagination').hidden = true; $('related-section').hidden = true;
    setStatus('search-status', 'Caricamento dei risultati…');
    const url = type === 'soggetti' ? `/api/soggetti/${state.query.split('/').map(encodeURIComponent).join('/')}?page=${page}` : `/api/search?q=${encodeURIComponent(state.query)}&page=${page}`;
    if (updateHistory) history.replaceState(null, '', `/?${searchParameters()}`);
    try {
      const data = await json(url);
      if (token === state.searchToken) {
        renderResults(data);
        if (scrollResults) $('result-heading').scrollIntoView?.({ block: 'start' });
      }
    }
    catch (error) { if (token === state.searchToken) setStatus('search-status', error.message, true); }
  }

  function disposeMedia() {
    state.playback = null;
    state.scrubTime = null;
    state.chapterSignature = null;
    $('timeline-tools').hidden = true;
    $('timeline-chapters').replaceChildren();
    $('seek-error').textContent = '';
    $('seek-error').hidden = true;
    for (const id of ['seek-minutes', 'seek-seconds']) { $(id).value = ''; $(id).setAttribute('aria-invalid', 'false'); }
    $('playback-tools').hidden = true;
    $('mini-toggle').disabled = true;
    $('mini-toggle').textContent = 'Riproduci';
    media.closest('.plyr')?.querySelector('.speaker-marker-layer')?.remove();
    if (state.hls) { state.hls.destroy(); state.hls = null; }
    state.timelineDuration = null;
    media.pause(); media.removeAttribute('src'); media.querySelectorAll('track').forEach(el => el.remove()); media.load();
    const wrapper = media.closest('.plyr');
    if (wrapper) wrapper.hidden = true;
    media.hidden = true;
    state.plyr = null;
  }

  function mediaDuration() {
    if (Number.isFinite(media.duration) && media.duration > 0) return media.duration;
    if (Number.isFinite(state.timelineDuration) && state.timelineDuration > 0) return state.timelineDuration;
    return null;
  }

  function recordingDuration() {
    const actual = mediaDuration();
    if (actual) return actual;
    const estimated = timeline.estimatedDuration(timeline.speakersForTrack(state.recording, state.track));
    if (estimated) return estimated;
    return state.recording?.tracks?.length === 1 ? timeline.parseDuration(state.recording.duration) : null;
  }

  function renderTimeline() {
    const progress = media.closest('.plyr')?.querySelector('.plyr__progress');
    progress?.querySelector('.speaker-marker-layer')?.remove();
    const speakers = timeline.speakersForTrack(state.recording, state.track);
    const duration = recordingDuration();
    const markers = timeline.markerPositions(speakers, duration);
    if (progress && markers.length) {
      const layer = node('div', 'speaker-marker-layer');
      layer.setAttribute('aria-hidden', 'true');
      for (const { speaker, percent } of markers) {
        const marker = node('span', 'speaker-marker');
        marker.style.left = `${percent}%`;
        marker.dataset.offset = String(speaker.offset);
        layer.append(marker);
      }
      progress.append(layer);
    }

    const slider = state.plyr?.elements?.inputs?.seek;
    if (slider && !boundSliders.has(slider)) {
      boundSliders.add(slider);
      const player = state.plyr;
      slider.addEventListener('input', () => {
        if (state.plyr !== player || !state.playback) return;
        const length = mediaDuration();
        if (!(length > 0)) return;
        state.scrubTime = Math.max(0, Math.min(100, Number(slider.value) || 0)) / 100 * length;
        updateSeekReadout();
      });
      for (const event of ['change', 'blur', 'pointerup', 'pointercancel', 'touchend']) {
        slider.addEventListener(event, () => {
          if (state.plyr !== player) return;
          state.scrubTime = null;
          updateSeekReadout();
        });
      }
    }

    const points = new Map();
    for (const speaker of speakers) {
      const key = Number(speaker.offset);
      if (duration > 0 && key > duration) continue;
      if (!points.has(key)) points.set(key, []);
      points.get(key).push(speaker.name);
    }
    const signature = JSON.stringify([state.recording?.id, state.track, [...points]]);
    const chapters = $('timeline-chapters');
    chapters.hidden = !points.size;
    if (signature !== state.chapterSignature) {
      state.chapterSignature = signature;
      chapters.replaceChildren();
      for (const [offset, names] of points) {
        const chapter = node('button', 'chapter-button'); chapter.type = 'button';
        chapter.dataset.offset = String(offset);
        chapter.setAttribute('aria-label', `Vai a ${names.join(', ')}, ${formatTime(offset)}`);
        chapter.title = `${formatTime(offset)} · ${names.join(', ')}`;
        chapter.append(node('span', 'chapter-time', formatTime(offset)), node('span', 'chapter-name', names.join(', ')));
        chapter.addEventListener('click', () => seekTo(offset));
        chapters.append(chapter);
      }
    }
    updateSpeaker();
  }

  function updateSeekReadout() {
    $('timeline-tools').hidden = !state.playback || state.live;
    if (!state.playback || state.live) return;
    const duration = mediaDuration();
    const seconds = state.scrubTime ?? state.playback.pendingSeek ?? media.currentTime;
    const speakers = timeline.speakersForTrack(state.recording, state.track);
    const current = timeline.speakerAt(speakers, seconds);
    const names = current ? speakers.filter(item => Number(item.offset) === Number(current.offset)).map(item => item.name).join(', ') : trackLabel(state.track);
    const preview = `${state.scrubTime === null ? '' : 'Vai a '}${formatTime(seconds)} · ${names}`;
    $('seek-preview').textContent = preview;
    $('seek-preview').title = preview;
    $('seek-preview').classList.toggle('is-preview', state.scrubTime !== null);
    $('seek-remaining').textContent = duration > 0 ? `${formatTime(Math.max(0, duration - seconds))} rimanenti` : 'Durata in caricamento…';
    for (const id of ['seek-minutes', 'seek-seconds', 'seek-submit']) $(id).disabled = !(duration > 0);
    for (const chapter of $('timeline-chapters').children) {
      const active = !!current && Number(chapter.dataset.offset) === Number(current.offset);
      chapter.classList.toggle('active', active);
      chapter.setAttribute('aria-current', active ? 'true' : 'false');
    }
  }

  function jumpToTime(event) {
    event.preventDefault();
    if (!state.playback || state.live) return;
    const minutes = $('seek-minutes').value.trim();
    const seconds = $('seek-seconds').value.trim();
    const duration = mediaDuration();
    const target = Number(minutes || 0) * 60 + Number(seconds || 0);
    let error = '';
    if ((!minutes && !seconds) || !/^\d*$/.test(minutes) || !/^\d*$/.test(seconds) || Number(seconds) > 59 || !Number.isFinite(target)) error = 'Inserisci minuti interi e secondi da 0 a 59.';
    else if (!(duration > 0)) error = 'Attendi il caricamento della durata.';
    else if (target > duration) error = `La traccia termina a ${formatTime(duration)}. Scegli un punto precedente.`;
    $('seek-error').textContent = error;
    $('seek-error').hidden = !error;
    for (const id of ['seek-minutes', 'seek-seconds']) $(id).setAttribute('aria-invalid', String(!!error));
    if (!error) { state.scrubTime = null; seekTo(target, !media.paused || state.playback.autoplay); }
  }

  function startPlayback(element, playback = state.playback) {
    const attempt = element.play();
    if (attempt?.catch) attempt.catch(() => {
      if (playback === state.playback && element === media) setStatus('player-status', 'Premi Play per ascoltare questa registrazione.');
    });
  }

  function applyPendingPlayback() {
    const playback = state.playback;
    if (!playback || playback.element !== media) return;
    if (playback.pendingSeek !== null) {
      if (media.readyState < 1) return;
      try { media.currentTime = playback.pendingSeek; }
      catch { return; }
      playback.pendingSeek = null;
      updateSpeaker();
    }
    if (playback.autoplay && playback.streamReady) {
      playback.autoplay = false;
      startPlayback(media, playback);
    }
  }

  function seekTo(offset, autoplay = true) {
    if (!state.playback) return;
    state.playback.pendingSeek = Math.max(0, Number(offset) || 0);
    state.playback.autoplay = autoplay;
    applyPendingPlayback();
    updateSpeaker();
  }

  function skipPlayback(seconds) {
    if (!state.playback || state.live) return;
    const position = state.playback.pendingSeek ?? media.currentTime;
    const duration = recordingDuration();
    const target = Math.max(0, Math.min(duration || Infinity, position + seconds));
    seekTo(target, !media.paused || state.playback.autoplay);
  }

  function setMedia(url, subtitles = [], audio = true, poster = null, autoplay = false, seek = null) {
    disposeMedia();
    media = $(audio ? 'media-audio' : 'media-video');
    media.hidden = false;
    media.preload = autoplay ? 'auto' : 'metadata';
    const source = safeUrl(url);
    if (!source) { $('media-link').hidden = true; $('copy-media').hidden = true; setStatus('player-status', 'Nessun media riproducibile disponibile.', true); return; }
    const shell = media.closest('.media-shell'); shell.classList.toggle('audio-mode', audio);
    const posterElement = $('poster');
    if (poster && safeUrl(poster)) posterElement.style.backgroundImage = `url("${safeUrl(poster).replaceAll('"', '%22')}")`;
    else posterElement.style.backgroundImage = '';
    if (!audio) media.poster = safeUrl(poster) || '';
    for (const entry of subtitles) {
      const src = safeUrl(entry.src); if (!src) continue;
      const track = document.createElement('track'); track.kind = 'subtitles'; track.src = src; track.srclang = entry.srclang || 'it'; track.label = entry.label || 'Sottotitoli'; media.append(track);
    }
    const isHls = /\.m3u8(?:\?|$)/i.test(source);
    const hlsSupported = !!window.Hls?.isSupported();
    const playback = { element: media, pendingSeek: seek === null ? null : Math.max(0, Number(seek) || 0), autoplay, streamReady: !(isHls && hlsSupported) };
    state.playback = playback;
    if (window.Plyr && !players.has(media)) {
      try {
        const player = new window.Plyr(media, { seekTime: 5, tooltips: { controls: true, seek: true }, speed: { selected: state.rate, options: playbackRates }, controls: audio ? ['play', 'progress', 'current-time', 'duration', 'mute', 'volume'] : ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'] });
        players.set(media, player);
        player.on('ready', () => { if (player === state.plyr) renderTimeline(); });
      } catch { /* native controls remain */ }
    }
    state.plyr = players.get(media) || null;
    const wrapper = media.closest('.plyr');
    if (wrapper) wrapper.hidden = false;
    if (isHls && hlsSupported) {
      state.hls = new window.Hls(seek === null ? {} : { startPosition: playback.pendingSeek });
      state.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (playback !== state.playback) return;
        playback.streamReady = true;
        applyPendingPlayback();
      });
      state.hls.on(window.Hls.Events.LEVEL_LOADED, (_, data) => {
        if (playback !== state.playback) return;
        if (!data.details?.live) {
          state.timelineDuration = Number(data.details?.totalduration);
          renderTimeline();
        }
      });
      state.hls.on(window.Hls.Events.ERROR, (_, detail) => { if (playback === state.playback && detail.fatal) setStatus('player-status', 'Riproduzione HLS non disponibile. Prova il link media.', true); });
      state.hls.attachMedia(media); state.hls.loadSource(source);
    } else { media.src = source; media.load(); }
    media.defaultPlaybackRate = state.rate;
    media.playbackRate = state.rate;
    $('playback-speed').value = String(state.rate);
    $('playback-tools').hidden = state.live;
    $('mini-toggle').disabled = false;
    renderTimeline();
    $('copy-media').hidden = false; $('copy-media').dataset.url = source;
    $('media-link').hidden = false; $('media-link').href = source;
    if (isHls && !hlsSupported && !media.canPlayType('application/vnd.apple.mpegurl')) setStatus('player-status', 'Hls.js non è disponibile in questo browser. Verifica la connessione al CDN oppure apri il link media.', true);
    else if (!window.Plyr) setStatus('player-status', 'Plyr non è disponibile. Sono attivi i controlli del browser.', true);
    else setStatus('player-status', '');
    applyPendingPlayback();
  }

  function renderSpeakers(recording) {
    const list = $('speakers'); list.replaceChildren();
    const speakers = recording.speakers || [];
    $('speaker-filter').value = '';
    $('speakers-section').hidden = !speakers.length;
    for (const speaker of speakers) {
      const item = node('button', 'speaker-item'); item.type = 'button'; item.dataset.offset = String(speaker.offset || 0); item.dataset.fileIndex = String(speaker.fileIndex || 0);
      item.dataset.search = normalizeFilter([speaker.name, speaker.role, trackLabel(Number(speaker.fileIndex || 0))].filter(Boolean).join(' '));
      const position = node('span', 'speaker-position');
      position.append(node('span', 'speaker-track', trackLabel(Number(speaker.fileIndex || 0))), node('span', 'speaker-time', formatTime(speaker.offset)));
      item.append(position);
      const name = node('span', 'speaker-name', speaker.name);
      if (speaker.role) name.append(node('span', 'speaker-role', speaker.role));
      item.append(name, node('span', 'speaker-play', '▶'));
      item.addEventListener('click', () => {
        const index = Number(speaker.fileIndex || 0);
        if (index !== state.track && recording.tracks[index]) selectTrack(index, speaker.offset || 0, true);
        else seekTo(speaker.offset);
      });
      list.append(item);
    }
    filterSpeakers();
  }

  function normalizeFilter(value) {
    return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  function filterSpeakers() {
    const words = normalizeFilter($('speaker-filter').value).split(/\s+/).filter(Boolean);
    const items = [...$('speakers').children];
    let count = 0;
    for (const item of items) {
      item.hidden = !words.every(word => item.dataset.search.includes(word));
      if (!item.hidden) count++;
    }
    $('speaker-count').textContent = words.length ? `${count} di ${items.length}` : `${items.length} interventi`;
    $('speaker-filter-empty').hidden = count !== 0;
  }

  function updateSpeaker() {
    updateSeekReadout();
    const recording = state.recording;
    if (!recording) return;
    const speakers = timeline.speakersForTrack(recording, state.track);
    const seconds = state.playback?.pendingSeek ?? media.currentTime;
    const current = timeline.speakerAt(speakers, seconds);
    const upcoming = current ? null : timeline.nextSpeaker(speakers, seconds);
    const active = current ? speakers.filter(item => Number(item.offset) === Number(current.offset)) : [];
    $('speaker-now').hidden = false;
    if (current || upcoming) {
      const shown = current || upcoming;
      $('speaker-now-label').textContent = current ? 'INTERVENTO IN CORSO' : 'PROSSIMO INTERVENTO';
      $('speaker-now-name').textContent = current ? active.map(item => item.name).join(', ') : shown.name;
      const roles = current ? [...new Set(active.map(item => item.role).filter(Boolean))].join(' · ') : shown.role;
      $('speaker-now-meta').textContent = `${trackLabel(state.track)} · ${current ? 'Da' : 'Al minuto'} ${formatTime(shown.offset)}${roles ? ` · ${roles}` : ''}`;
    } else {
      $('speaker-now-label').textContent = 'INTERVENTI';
      $('speaker-now-name').textContent = speakers.length ? 'Nessun intervento in questo punto' : 'Oratori non indicizzati';
      $('speaker-now-meta').textContent = speakers.length ? 'Scegli un intervento qui sotto.' : 'La scheda non fornisce ancora i punti degli interventi.';
    }
    document.querySelectorAll('.speaker-item').forEach(el => el.classList.toggle('active', !!current && Number(el.dataset.offset) === Number(current.offset) && Number(el.dataset.fileIndex) === state.track));
    media.closest('.plyr')?.querySelectorAll('.speaker-marker').forEach(el => el.classList.toggle('active', !!current && Number(el.dataset.offset) === Number(current.offset)));
  }

  function selectTrack(index, seek = null, autoplay = false) {
    const track = state.recording?.tracks?.[index]; if (!track) return;
    state.track = index; $('track-select').value = String(index);
    $('player-kind').textContent = `${trackLabel(index)} di ${state.recording.tracks.length}`;
    setMedia(track.m3u8, track.subtitles, track.audio, state.recording.poster, autoplay || seek !== null, seek);
    updateSpeaker();
  }

  function renderRecording(recording, autoplay = false) {
    state.recording = recording; state.live = false;
    $('empty-player').hidden = true; $('loaded-player').hidden = false; $('detail-content').hidden = false;
    $('player-kind').textContent = 'ARCHIVIO';
    $('recording-title').textContent = recording.title || `Registrazione ${recording.id}`;
    $('recording-date').textContent = recording.date || '';
    $('recording-meta').textContent = [recording.category, recording.location, recording.duration].filter(Boolean).join(' · ');
    $('detail-summary').textContent = recording.summary || ''; $('detail-summary').hidden = !recording.summary;
    const topics = $('topics'); topics.replaceChildren();
    for (const topic of (recording.topics || []).slice(0, 12)) topics.append(node('span', '', topic));
    topics.hidden = !topics.children.length;
    const select = $('track-select'); select.replaceChildren();
    for (const [index, track] of (recording.tracks || []).entries()) { const option = node('option', '', trackLabel(index)); option.value = String(index); option.title = track.title || ''; select.append(option); }
    $('track-container').hidden = select.options.length < 2;
    const source = safeUrl(recording.canonicalUrl);
    $('source-link').hidden = !source; if (source) $('source-link').href = source;
    $('json-link').hidden = !recording.id; $('json-link').href = `/api/scheda/${encodeURIComponent(recording.id)}`;
    renderSpeakers(recording);
    if (recording.tracks?.length) selectTrack(0, null, autoplay);
    else { disposeMedia(); $('copy-media').hidden = true; $('media-link').hidden = true; updateSpeaker(); setStatus('player-status', 'Nessuna traccia disponibile per questa scheda.'); }
    $('mini-player').hidden = false; $('mini-title').textContent = recording.title || 'Registrazione'; $('mini-state').textContent = 'Tocca per aprire';
    showTab('player');
  }

  async function openRecording(input, autoplay = false) {
    const value = String(input || '').trim(); if (!value) return;
    const token = ++state.detailToken; setStatus('player-status', 'Caricamento della scheda…'); showTab('player');
    const url = /^\d+$/.test(value) ? `/api/scheda/${value}` : `/api/scheda?url=${encodeURIComponent(value)}`;
    try {
      const data = await json(url); if (token !== state.detailToken) return;
      renderRecording(data, autoplay);
      const params = searchParameters(); params.set('id', data.id);
      history.replaceState(null, '', `/?${params}`);
    } catch (error) { if (token === state.detailToken) setStatus('player-status', error.message, true); }
  }

  function openLive(autoplay = false) {
    ++state.detailToken; state.recording = null; state.live = true;
    $('empty-player').hidden = true; $('loaded-player').hidden = false; $('detail-content').hidden = true;
    $('player-kind').textContent = 'IN DIRETTA'; $('recording-date').textContent = 'ORA IN ONDA';
    $('recording-title').textContent = 'Radio Radicale in diretta'; $('recording-meta').textContent = 'Il flusso audio in tempo reale';
    $('track-container').hidden = true; $('speaker-now').hidden = true; $('source-link').hidden = false; $('source-link').href = 'https://www.radioradicale.it'; $('json-link').hidden = false; $('json-link').href = '/api/live';
    setMedia('https://live.radioradicale.it/live.mp3', [], true, null, autoplay);
    $('mini-player').hidden = false; $('mini-title').textContent = 'Radio Radicale in diretta'; $('mini-state').textContent = 'Tocca per aprire';
    showTab('player'); history.replaceState(null, '', '/?live=1');
  }

  $('search-form').addEventListener('submit', event => { event.preventDefault(); const q = $('search-input').value.trim(); if (q) search(q); });
  $('open-form').addEventListener('submit', event => { event.preventDefault(); openRecording($('open-input').value); });
  $('live-button').addEventListener('click', () => openLive(true));
  $('track-select').addEventListener('change', event => selectTrack(Number(event.target.value), null, true));
  $('speaker-filter').addEventListener('input', filterSpeakers);
  $('seek-form').addEventListener('submit', jumpToTime);
  for (const id of ['seek-minutes', 'seek-seconds']) $(id).addEventListener('input', () => {
    $('seek-error').textContent = '';
    $('seek-error').hidden = true;
    $('seek-minutes').setAttribute('aria-invalid', 'false');
    $('seek-seconds').setAttribute('aria-invalid', 'false');
  });
  $('skip-back').addEventListener('click', () => skipPlayback(-15));
  $('skip-forward').addEventListener('click', () => skipPlayback(15));
  $('playback-speed').addEventListener('change', event => {
    const rate = Number(event.target.value);
    if (!playbackRates.includes(rate)) return;
    state.rate = rate;
    media.defaultPlaybackRate = rate;
    media.playbackRate = rate;
  });
  $('mini-toggle').addEventListener('click', () => {
    if (!state.playback) return;
    if (media.paused) { state.playback.autoplay = true; applyPendingPlayback(); }
    else media.pause();
  });
  $('copy-media').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('copy-media').dataset.url); $('copy-media').textContent = 'Link copiato ✓'; setTimeout(() => $('copy-media').textContent = 'Copia link media', 1800); } catch { setStatus('player-status', 'Copia non disponibile. Apri il link media dal browser.', true); } });
  $('prev-page').addEventListener('click', () => { if (state.page > 0) search(state.query, state.page - 1, state.type, true, true); });
  $('next-page').addEventListener('click', () => { if (state.pagination?.hasNext) search(state.query, state.page + 1, state.type, true, true); });
  $('page-form').addEventListener('submit', event => {
    event.preventDefault();
    const number = Number($('page-number').value);
    if (!Number.isSafeInteger(number) || number < 1 || (state.pagination?.totalPagesKnown && number > state.pagination.totalPages)) {
      $('page-number').reportValidity?.();
      return;
    }
    if (number - 1 !== state.page) search(state.query, number - 1, state.type, true, true);
  });
  $('tab-search').addEventListener('click', () => showTab('search')); $('tab-player').addEventListener('click', () => showTab('player')); $('mini-open').addEventListener('click', () => showTab('player'));
  for (const element of [$('media-video'), $('media-audio')]) {
    element.addEventListener('timeupdate', () => { if (element === media) updateSpeaker(); });
    for (const event of ['loadedmetadata', 'durationchange', 'canplay']) {
      element.addEventListener(event, () => {
        if (element !== media) return;
        applyPendingPlayback(); renderTimeline(); updateSpeaker();
      });
    }
    element.addEventListener('seeked', () => { if (element === media) updateSpeaker(); });
    element.addEventListener('ended', () => {
      if (element !== media || state.live) return;
      if (state.recording?.tracks?.[state.track + 1]) selectTrack(state.track + 1, null, true);
      else updateSpeaker();
    });
    element.addEventListener('play', () => { if (element === media) { $('mini-state').textContent = 'In riproduzione'; $('mini-toggle').textContent = 'Pausa'; setStatus('player-status', ''); } });
    element.addEventListener('pause', () => { if (element === media) { $('mini-state').textContent = 'In pausa'; $('mini-toggle').textContent = 'Riproduci'; } });
    element.addEventListener('ratechange', () => {
      if (element !== media) return;
      state.rate = media.playbackRate;
      $('playback-speed').value = String(state.rate);
    });
    element.addEventListener('error', () => { if (element === media && media.currentSrc) setStatus('player-status', 'Impossibile riprodurre il media in questo browser.', true); });
  }

  const params = new URLSearchParams(location.search);
  const requestedPage = Number(params.get('page'));
  const initialPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage - 1 : 0;
  if (params.has('subject')) search(params.get('subject'), initialPage, 'soggetti', false);
  else if (params.has('q')) search(params.get('q') || 'giustizia', initialPage, 'general', false);
  else search('giustizia', 0, 'general', false);
  if (params.get('live') === '1') openLive();
  else if (params.has('id') || params.has('url')) openRecording(params.get('id') || params.get('url'));
})();
