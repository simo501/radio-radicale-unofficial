import { config } from '../config/index.js';
import { gzipSync } from 'node:zlib';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function decodeEntities(value = '') {
  return String(value).replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos|nbsp|ndash|mdash|hellip);?/gi, (whole, code) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…' };
    if (code[0] !== '#') return named[code.toLowerCase()] ?? whole;
    const point = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

export function cleanText(html = '') {
  return decodeEntities(String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function attr(tag, name) {
  const match = String(tag).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

export function absoluteUrl(value, base = config.upstream) {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function approvedPageUrl(value) {
  try {
    const url = new URL(value, config.upstream);
    if (url.protocol !== 'https:' || !['www.radioradicale.it', 'radioradicale.it'].includes(url.hostname) || !/^\/scheda\/\d+(?:\/[^?#]*)?$/.test(url.pathname)) throw new Error();
    url.hash = '';
    return url.href;
  } catch { throw new HttpError(400, 'Use an HTTPS Radio Radicale recording URL.'); }
}

export function nonnegative(value, name, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  if (!/^(0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new HttpError(400, `${name} must be a nonnegative integer.`);
  return Number(value);
}

export async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    let current = url;
    const originalPath = new URL(url).pathname;
    const expectedPath = originalPath.startsWith('/scheda/') ? /^\/scheda\/\d+(?:\/|$)/ : originalPath.startsWith('/soggetti/') ? /^\/soggetti\// : /^\/cerca(?:\/|$)/;
    for (let redirects = 0; redirects < 4; redirects++) {
      const checked = new URL(current);
      if (checked.protocol !== 'https:' || !['radioradicale.it', 'www.radioradicale.it'].includes(checked.hostname) || !expectedPath.test(checked.pathname)) throw new HttpError(502, 'Upstream redirected to an unexpected page.');
      const response = await fetch(current, { signal: controller.signal, redirect: 'manual', headers: { 'user-agent': config.userAgent, accept: 'text/html' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        current = new URL(response.headers.get('location') || '', current).href;
        continue;
      }
      if (!response.ok) throw new HttpError(response.status === 404 ? 404 : 502, `Upstream returned HTTP ${response.status}.`);
      const length = Number(response.headers.get('content-length'));
      if (length > config.maxHtmlBytes) throw new HttpError(502, 'Upstream page is too large.');
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > config.maxHtmlBytes) { await reader.cancel(); throw new HttpError(502, 'Upstream page is too large.'); }
        chunks.push(value);
      }
      return { html: new TextDecoder().decode(Buffer.concat(chunks)), finalUrl: current };
    }
    throw new HttpError(502, 'Too many upstream redirects.');
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, error.name === 'AbortError' ? 'Upstream request timed out.' : 'Could not reach Radio Radicale.');
  } finally { clearTimeout(timeout); }
}

export function send(req, res, status, body, contentType = 'application/json; charset=utf-8', headers = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const zip = data.length > 1024 && /gzip/.test(req.headers['accept-encoding'] || '') && /(?:json|html|css|javascript)/.test(contentType);
  const bytes = zip ? gzipSync(data) : data;
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': bytes.length, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Accept, Content-Type', 'Vary': 'Accept-Encoding', ...(zip ? { 'Content-Encoding': 'gzip' } : {}), ...headers });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}
