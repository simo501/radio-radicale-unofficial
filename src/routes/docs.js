import { send } from '../core/utils.js';

export function routeDocs(req, res, pathname) {
  if (!['/docs', '/api-docs'].includes(pathname)) return false;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>API · Radio Radicale archive</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:auto;padding:24px;color:#20231f}a{color:#145b50}code{background:#eef2ed;padding:2px 5px;overflow-wrap:anywhere}li{margin:12px 0}</style><h1>Radio Radicale archive API</h1><p>Unofficial, read-only API for public pages. <a href="/">Open the player</a>.</p><ul><li><code>GET /api/search?q=giustizia&amp;page=0</code> · archive search</li><li><code>GET /api/soggetti/86/marco-pannella?page=0</code> · subject listing</li><li><code>GET /api/scheda/163473</code> · recording metadata and tracks</li><li><code>GET /api/m3u8/163473?track=0&amp;redirect=false</code> · HLS source JSON (redirect by default)</li><li><code>GET /api/live</code> and <code>GET /api/live/stream</code> · live stream</li><li><code>GET /health</code> · process health</li></ul><p>Search accepts <code>q</code> or <code>query</code>, <code>type=general|soggetti</code>, and zero-based <code>page</code>. Detail accepts an ID or approved <code>url</code>. Responses are JSON unless a stream endpoint redirects. This API does not proxy media.</p>`;
  send(req, res, 200, html, 'text/html; charset=utf-8');
  return true;
}
