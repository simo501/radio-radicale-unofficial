import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { send } from '../core/utils.js';

const root = path.resolve(fileURLToPath(new URL('../ui/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const cache = new Map();

export async function routeStatic(req, res, pathname) {
  const filename = ['/', '/app', '/player', '/player.html'].includes(pathname) ? 'index.html' : pathname.startsWith('/ui/') ? pathname.slice(4) : null;
  if (!filename) return false;
  const target = path.resolve(root, filename);
  if (!target.startsWith(root + path.sep) && target !== path.resolve(root, 'index.html')) return false;
  const info = await stat(target).catch(() => null);
  if (!info?.isFile()) return false;
  let entry = cache.get(target);
  if (!entry || entry.mtime !== info.mtimeMs) {
    entry = { mtime: info.mtimeMs, data: await readFile(target) };
    if (cache.size >= 24) cache.delete(cache.keys().next().value);
    cache.set(target, entry);
  }
  send(req, res, 200, entry.data, mime[path.extname(target)] || 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  return true;
}
