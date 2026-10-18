import { config } from '../config/index.js';
import { apiCache } from '../core/cache.js';
import { approvedPageUrl, HttpError, nonnegative, send } from '../core/utils.js';
import { getSearch } from '../services/search.js';
import { getRecording } from '../services/extractor.js';
import { liveInfo } from '../services/live.js';

async function cached(key, loader) {
  const value = apiCache.get(key);
  if (value !== undefined) return { value, state: 'HIT' };
  const loaded = await loader();
  apiCache.set(key, loaded);
  return { value: loaded, state: 'MISS' };
}

function recordingInput(url, pathId) {
  const input = pathId || url.searchParams.get('id') || url.searchParams.get('url');
  if (!input) throw new HttpError(400, 'Recording ID or URL is required.');
  if (/^\d+$/.test(input)) return input;
  if (pathId) throw new HttpError(400, 'Recording ID must be numeric.');
  return approvedPageUrl(input);
}

async function recording(input) {
  const id = String(input).match(/\/scheda\/(\d+)/)?.[1] || input;
  return cached(`recording:${id}`, () => getRecording(input));
}

export async function routeApi(req, res, url) {
  const path = url.pathname;
  if (path === '/health' || path === '/api/health') {
    const usage = process.memoryUsage();
    send(req, res, 200, { status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), memory: { rssMB: +(usage.rss / 1048576).toFixed(1), heapUsedMB: +(usage.heapUsed / 1048576).toFixed(1) }, cacheEntries: apiCache.size });
    return true;
  }
  if (path === '/api/live') { send(req, res, 200, liveInfo); return true; }
  if (path === '/api/live/stream') { send(req, res, 302, '', 'text/plain; charset=utf-8', { Location: config.liveStream }); return true; }

  if (path === '/api/search' || path === '/api/cerca' || path.startsWith('/api/soggetti/')) {
    let subject = null;
    if (path.startsWith('/api/soggetti/')) {
      try { subject = decodeURIComponent(path.slice('/api/soggetti/'.length)); }
      catch { throw new HttpError(400, 'Invalid subject path.'); }
    }
    const query = subject || url.searchParams.get('q') || url.searchParams.get('query');
    const type = subject ? 'soggetti' : url.searchParams.get('type') || 'general';
    const page = nonnegative(url.searchParams.get('page'), 'page');
    if (!query) throw new HttpError(400, 'Search query is required.');
    const key = `search:${type === 'general' ? 'all' : type}:${query.trim()}:${page}`;
    const { value, state } = await cached(key, () => getSearch(query, page, type));
    send(req, res, 200, value, undefined, { 'X-Cache': state });
    return true;
  }

  const detail = path === '/api/scheda' || /^\/api\/scheda\/[^/]+$/.test(path);
  if (detail) {
    const input = recordingInput(url, path === '/api/scheda' ? null : path.slice('/api/scheda/'.length));
    const { value, state } = await recording(input);
    send(req, res, 200, value, undefined, { 'X-Cache': state });
    return true;
  }

  const streamMatch = path.match(/^\/api\/(?:m3u8|stream)\/([^/]+)$/);
  if (streamMatch) {
    const input = recordingInput(url, streamMatch[1]);
    const trackIndex = nonnegative(url.searchParams.get('track'), 'track');
    const { value, state } = await recording(input);
    const track = value.tracks[trackIndex];
    if (!track?.m3u8) throw new HttpError(404, 'No HLS source for this track.');
    const data = { id: value.id, title: value.title, trackIndex, m3u8: track.m3u8, audio: track.audio, subtitles: track.subtitles };
    if (url.searchParams.get('redirect') === 'false' || /application\/json/.test(req.headers.accept || '')) send(req, res, 200, data, undefined, { 'X-Cache': state });
    else send(req, res, 302, '', 'text/plain; charset=utf-8', { Location: track.m3u8, 'X-Cache': state });
    return true;
  }
  return false;
}
