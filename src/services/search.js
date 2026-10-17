import { config } from '../config/index.js';
import { absoluteUrl, attr, cleanText, fetchHtml, HttpError, nonnegative } from '../core/utils.js';

export function searchUrl(query, page = 0, type = 'general') {
  page = nonnegative(page, 'page');
  if (type === 'soggetti') {
    if (!/^\d+(?:\/[a-z0-9-]+)?$/i.test(query)) throw new HttpError(400, 'Invalid subject path.');
    return `${config.upstream}/soggetti/${query}${page ? `?page=${page}` : ''}`;
  }
  if (type !== 'general') throw new HttpError(400, 'type must be general or soggetti.');
  if (!String(query || '').trim()) throw new HttpError(400, 'Search query is required.');
  if (String(query).length > 200) throw new HttpError(400, 'Search query is too long.');
  const url = new URL('/cerca', config.upstream);
  url.searchParams.set('raggruppamenti_radio', '6');
  url.searchParams.set('search_api_views_fulltext', String(query).trim());
  if (page) url.searchParams.set('page', String(page));
  return url.href;
}

function firstMatch(html, patterns) {
  for (const re of patterns) {
    const match = html.match(re);
    if (match) return cleanText(match[1]) || null;
  }
  return null;
}

function parsePagination(html, page, resultCount, pageUrl) {
  const base = new URL(pageUrl || '/cerca', config.upstream);
  const pages = new Set([page]);
  let hasPager = /<(?:ul|ol|nav|div)\b[^>]*(?:class|id)=["'][^"']*\b(?:pager|pagination)\b/i.test(html);
  let lastPage = null;
  const linkedPage = tag => {
    try {
      const url = new URL(attr(tag, 'href'), base);
      const value = url.searchParams.get('page');
      if (url.origin !== base.origin || url.pathname !== base.pathname || !/^\d+$/.test(value || '')) return null;
      const number = Number(value);
      return Number.isSafeInteger(number) ? number : null;
    } catch { return null; }
  };
  for (const link of html.matchAll(/<a\b[^>]*>/gi)) {
    const number = linkedPage(link[0]);
    if (number === null) continue;
    pages.add(number); hasPager = true;
    if (/\blast\b/i.test(attr(link[0], 'rel')) || /(?:last\s+page|ultima\s+pagina)/i.test(attr(link[0], 'title')) || /\bpager(?:-|__item--)last\b/i.test(attr(link[0], 'class'))) lastPage = Math.max(lastPage ?? 0, number);
  }
  for (const item of html.matchAll(/<li\b[^>]*class=["'][^"']*\bpager(?:-|__item--)last\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const tag = item[1].match(/<a\b[^>]*>/i)?.[0];
    const number = tag ? linkedPage(tag) : null;
    if (number !== null) lastPage = Math.max(lastPage ?? 0, number);
  }
  const hasNext = [...pages].some(number => number > page) || (!hasPager && resultCount > 0);
  const totalPagesKnown = lastPage !== null || (hasPager && !hasNext) || (page === 0 && resultCount === 0);
  const furthest = [...pages].reduce((highest, number) => Math.max(highest, number), page);
  const totalPages = lastPage !== null ? lastPage + 1 : Math.max(page + (hasNext ? 2 : 1), furthest + 1);
  return { currentPage: page, totalPages, totalPagesKnown, hasNext, hasPrev: page > 0 };
}

export function parseSearch(html, { query, type = 'general', page = 0, searchUrl: requestedUrl, finalUrl = requestedUrl } = {}) {
  const results = [];
  const seen = new Set();
  const blocks = [...html.matchAll(/<li\b[^>]*class\s*=\s*["'][^"']*\bclearfix\b[^"']*["'][^>]*>[\s\S]*?<\/li>/gi)].map(m => m[0]);
  for (const block of blocks) {
    const links = [...block.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)];
    const link = links.find(m => /\/scheda\/(\d+)/.test(m[1] || m[2]));
    if (!link) continue;
    const href = link[1] || link[2];
    const id = href.match(/\/scheda\/(\d+)/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const heading = block.match(/<h[2-5]\b[^>]*>([\s\S]*?)<\/h[2-5]>/i)?.[1];
    const title = cleanText(heading || link[3]);
    const imageTag = block.match(/<img\b[^>]*>/i)?.[0];
    const thumbnail = imageTag ? absoluteUrl(attr(imageTag, 'src') || attr(imageTag, 'data-src')) : null;
    const date = firstMatch(block, [/<time\b[^>]*>([\s\S]*?)<\/time>/i, /<[^>]+class=["'][^"']*\bdate\b[^"']*["'][^>]*>([\s\S]*?)<\//i, /<[^>]+class=["'][^"']*\bdata\b[^"']*["'][^>]*>([\s\S]*?)<\//i]);
    const timeTag = block.match(/<time\b[^>]*>/i)?.[0];
    const dateIso = timeTag ? attr(timeTag, 'datetime') || null : null;
    const category = firstMatch(block, [/<[^>]+class=["'][^"']*(?:category|categoria|tipologia)[^"']*["'][^>]*>([\s\S]*?)<\//i]);
    const location = firstMatch(block, [/<[^>]+class=["'][^"']*(?:location|luogo)[^"']*["'][^>]*>([\s\S]*?)<\//i]);
    const duration = firstMatch(block, [/<[^>]+class=["'][^"']*(?:duration|durata)[^"']*["'][^>]*>([\s\S]*?)<\//i]);
    const context = cleanText(block).toLowerCase();
    const mediaType = /\bvideo\b/.test(context) ? 'video' : /\baudio\b/.test(context) ? 'audio' : null;
    results.push({ id, title: title || `Registrazione ${id}`, href, url: absoluteUrl(href), mediaType, date, dateIso, category, location, duration, thumbnail });
  }
  const pagination = parsePagination(html, page, results.length, finalUrl || requestedUrl);
  const related = [];
  const relatedSeen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1] || match[2];
    if (!/^\/soggetti\/[\w\/-]+/.test(href) || relatedSeen.has(href)) continue;
    relatedSeen.add(href);
    related.push({ href, url: absoluteUrl(href), text: cleanText(match[3]) });
    if (related.length >= 20) break;
  }
  return { query, type, searchUrl: requestedUrl, finalUrl, results, count: results.length, pagination, related };
}

export async function getSearch(query, page = 0, type = 'general') {
  const requestedUrl = searchUrl(query, page, type);
  const { html, finalUrl } = await fetchHtml(requestedUrl);
  return parseSearch(html, { query, page, type, searchUrl: requestedUrl, finalUrl });
}
