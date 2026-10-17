import { config } from '../config/index.js';
import { absoluteUrl, approvedPageUrl, attr, cleanText, fetchHtml, HttpError } from '../core/utils.js';

export function extractJsonObject(source, start) {
  const first = source.indexOf('{', start);
  if (first < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = first; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try { return JSON.parse(source.slice(first, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function settingsFrom(html) {
  for (const marker of ['Drupal.settings,', 'Drupal.settings =', 'Drupal.settings=']) {
    let at = html.indexOf(marker);
    while (at >= 0) {
      const parsed = extractJsonObject(html, at + marker.length);
      if (parsed) return parsed;
      at = html.indexOf(marker, at + marker.length);
    }
  }
  return {};
}

function meta(html, key) {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    if ([attr(tag[0], 'name'), attr(tag[0], 'property')].some(value => value.toLowerCase() === key.toLowerCase())) return attr(tag[0], 'content') || null;
  }
  return null;
}

function contentByClass(html, classes) {
  const re = new RegExp(`<([a-z][\\w-]*)\\b[^>]*class=["'][^"']*(?:${classes})[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i');
  return cleanText(html.match(re)?.[2] || '') || null;
}

function mediaUrl(source) {
  if (typeof source === 'string') return absoluteUrl(source);
  if (!source || typeof source !== 'object') return null;
  return absoluteUrl(source.file || source.src || source.url || source.uri || source.m3u8);
}

function normalizeTrack(item, index) {
  const sources = (Array.isArray(item.sources) ? item.sources : item.sources ? [item.sources] : []).map(mediaUrl).filter(Boolean);
  const direct = mediaUrl(item.m3u8 || item.file || item.url);
  if (direct && !sources.includes(direct)) sources.unshift(direct);
  const subtitles = (Array.isArray(item.subtitles) ? item.subtitles : Array.isArray(item.tracks) ? item.tracks : []).map(entry => {
    const url = mediaUrl(entry);
    return url ? { src: url, srclang: entry.srclang || entry.lang || 'it', label: entry.label || 'Sottotitoli' } : null;
  }).filter(Boolean);
  const m3u8 = sources.find(url => /\.m3u8(?:\?|$)/i.test(url)) || sources[0] || null;
  return { index, title: cleanText(item.title || item.name || `Traccia ${index + 1}`), m3u8, audio: item.audio === true || item.audio === 1 || /audio/i.test(String(item.type || item.mime || '')), sources, subtitles };
}

function speakerFrom(item) {
  if (!item || typeof item !== 'object') return null;
  const offset = Number(item.offset ?? item.start ?? item.time ?? 0);
  const fileIndex = Number(item.fileIndex ?? item.file_index ?? item.file ?? 0);
  const name = cleanText(item.name || item.nome || item.speaker || item.title || '');
  return name ? { id: String(item.id ?? ''), name, role: cleanText(item.role || item.qualifica || item.description || '') || null, offset: Number.isFinite(offset) ? offset : 0, durationSeconds: Number(item.durationSeconds ?? item.duration) || null, fileIndex: Number.isInteger(fileIndex) && fileIndex >= 0 ? fileIndex : 0 } : null;
}

export function parseInterventionsFromMarkup(html, trackCount) {
  const afterTitle = html.slice(Math.max(0, html.search(/<h1\b/i)));
  const tab = afterTitle.search(/>\s*Interventi\s*</i);
  if (tab < 0) return [];
  let section = afterTitle.slice(tab);
  const transcript = section.search(/Visualizza[\s\S]{0,300}trascrizione automatica/i);
  if (transcript > 0) section = section.slice(0, transcript);
  section = section.slice(0, 120000).replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, contents) => ` SPEAKERSTART${cleanText(contents)}SPEAKEREND `);
  const marked = cleanText(section);
  const timeAndLength = /\b\d{1,2}:\d{2}\s+Durata:\s*((?:(?:\d+)\s*(?:ore?|min(?:ut[io])?|sec(?:ond[io])?)\s*){1,3})/gi;
  const speakers = [];
  let cursor = 0, previousEnd = 0, fileIndex = 0;
  for (const match of marked.matchAll(timeAndLength)) {
    const before = marked.slice(previousEnd, match.index);
    const isPause = /\bPausa\b/i.test(before) && !/SPEAKERSTART/.test(before);
    if (isPause) { fileIndex = Math.min(fileIndex + 1, Math.max(0, trackCount - 1)); cursor = 0; }
    else {
      const entries = [...before.matchAll(/SPEAKERSTART(.*?)SPEAKEREND/g)].map((item, index, matches) => {
        const name = item[1].trim();
        const next = matches[index + 1]?.index ?? before.length;
        const role = before.slice(item.index + item[0].length, next).trim();
        return { name, role: role || null };
      }).filter(item => item.name && !/^(?:Interventi|Trascrizione automatica)$/i.test(item.name));
      const hours = Number(match[1].match(/(\d+)\s*ore?/i)?.[1] || 0);
      const minutes = Number(match[1].match(/(\d+)\s*min/i)?.[1] || 0);
      const seconds = Number(match[1].match(/(\d+)\s*sec/i)?.[1] || 0);
      const length = hours * 3600 + minutes * 60 + seconds;
      for (const { name, role } of entries) speakers.push({ id: String(speakers.length + 1), name, role, offset: cursor, durationSeconds: length || null, fileIndex });
      cursor += length;
    }
    previousEnd = match.index + match[0].length;
  }
  return speakers;
}

export function parseRecording(html, pageUrl) {
  const settings = settingsFrom(html);
  const rr = settings.RRscheda || settings.rrscheda || {};
  const id = String(rr.id || pageUrl.match(/\/scheda\/(\d+)/)?.[1] || '');
  const playlist = Array.isArray(rr.playlist) ? rr.playlist : Array.isArray(rr.playlist?.items) ? rr.playlist.items : [];
  const tracks = playlist.map(normalizeTrack);
  const interventions = rr.interventions || rr.interventi || rr.speakers || [];
  let speakers = (Array.isArray(interventions) ? interventions : Object.values(interventions)).map(speakerFrom).filter(Boolean);
  if (!speakers.length) {
    speakers = [...html.matchAll(/<[^>]+data-offset=["'](\d+(?:\.\d+)?)["'][^>]*>([\s\S]*?)<\//gi)].map((match, index) => ({ id: String(index + 1), name: cleanText(match[2]), role: null, offset: Number(match[1]), durationSeconds: null, fileIndex: 0 })).filter(item => item.name);
  }
  if (!speakers.length) speakers = parseInterventionsFromMarkup(html, tracks.length);
  const canonicalTag = [...html.matchAll(/<link\b[^>]*>/gi)].find(match => attr(match[0], 'rel').toLowerCase() === 'canonical')?.[0];
  let canonicalUrl;
  try { canonicalUrl = approvedPageUrl(attr(canonicalTag || '', 'href') || pageUrl); }
  catch { canonicalUrl = approvedPageUrl(pageUrl); }
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const title = cleanText(heading || meta(html, 'og:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '') || `Registrazione ${id}`;
  const topicLinks = [...html.matchAll(/<a\b[^>]*href=["'][^"']*\/soggetti\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map(match => cleanText(match[1])).filter(Boolean);
  const transcriptUrls = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map(match => absoluteUrl(match[1], pageUrl)).filter(url => url && /(?:trascrizion|transcript)/i.test(url));
  let poster = meta(html, 'og:image');
  if (!poster) {
    const ld = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    try { const data = JSON.parse(ld?.[1] || '{}'); poster = data.thumbnailUrl || data.image || null; } catch { /* optional data */ }
  }
  return {
    id, title, date: rr.date || contentByClass(html, 'date|data') || meta(html, 'article:published_time'),
    category: contentByClass(html, 'category|categoria|tipologia'), location: rr.location || contentByClass(html, 'location|luogo'),
    duration: contentByClass(html, 'duration|durata'), curator: contentByClass(html, 'curator|curatore'),
    summary: contentByClass(html, 'summary|abstract|descrizione') || meta(html, 'description'),
    topics: [...new Set(topicLinks)], poster: absoluteUrl(poster, pageUrl), hasTranscript: transcriptUrls.length > 0,
    transcriptUrls: [...new Set(transcriptUrls)], canonicalUrl, shortUrl: `${config.upstream}/scheda/${id}`,
    tracks, speakers, primaryM3u8: tracks.find(track => track.m3u8)?.m3u8 || null
  };
}

export async function getRecording(input) {
  const url = /^\d+$/.test(String(input)) ? `${config.upstream}/scheda/${input}` : approvedPageUrl(input);
  const { html, finalUrl } = await fetchHtml(url);
  const recording = parseRecording(html, finalUrl);
  if (!recording.id || (!recording.tracks.length && !/<h1\b/i.test(html))) throw new HttpError(502, 'Could not read this recording page.');
  return recording;
}
