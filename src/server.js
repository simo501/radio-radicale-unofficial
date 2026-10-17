import http from 'node:http';
import { config } from './config/index.js';
import { HttpError, send } from './core/utils.js';
import { routeApi } from './routes/api.js';
import { routeDocs } from './routes/docs.js';
import { routeStatic } from './routes/static.js';

export async function handleRequest(req, res) {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Accept, Content-Type' }); res.end(); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { send(req, res, 405, { error: 'Method not allowed.', statusCode: 405 }, undefined, { Allow: 'GET, HEAD, OPTIONS' }); return; }
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (await routeApi(req, res, url)) return;
      if (routeDocs(req, res, url.pathname)) return;
      if (await routeStatic(req, res, url.pathname)) return;
      send(req, res, 404, { error: 'Not found. See /docs for endpoints.', statusCode: 404 });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (!res.headersSent) send(req, res, status, { error: status === 500 ? 'Internal server error.' : error.message, statusCode: status });
    }
}

export function createServer() {
  return http.createServer(handleRequest);
}

if (process.env.NODE_ENV !== 'test' && process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const server = createServer().listen(config.port, () => console.log(`Radio Radicale API listening at http://localhost:${config.port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
