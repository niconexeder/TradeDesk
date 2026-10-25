import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Accounts } from './accounts.mjs';
import { verifyToken } from './auth.mjs';
import { TokenVault } from './token-store.mjs';
const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
const accountIdPattern = /^[\w-]{16,80}$/;
const validToken = token => typeof token === 'string' && token.trim().length >= 20 && token.trim().length <= 512 && !/\s/.test(token.trim());
const appDirectory = dirname(fileURLToPath(import.meta.url));
const defaultTokenVault = new TokenVault({
  helperPath: process.env.TRADEDESK_TOKEN_HELPER || join(appDirectory, 'tokenstore.exe'),
  filePath: process.env.TRADEDESK_TOKEN_FILE || ''
});
export function createApp(accounts = new Accounts(), verifier = verifyToken, tokenVault = defaultTokenVault) {
  const key = randomBytes(32).toString('hex');
  const server = http.createServer(async (req, res) => {
    const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const origin = `http://127.0.0.1:${server.address().port}`;
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Недопустимый источник запроса.' });
    try {
      if (req.url === '/api/session' && req.method === 'GET') return json(200, { key, apiVersion: 2, tokenPersistence: tokenVault.available });
      if (req.url.startsWith('/api/')) {
        if (req.headers['x-local-key'] !== key) return json(403, { error: 'Обновите страницу.' });
        if (req.url === '/api/status' && req.method === 'GET') {
          accounts.heartbeat(req.headers['x-client-id']);
          return json(200, accounts.snapshot());
        }
        if (req.url === '/api/tokens' && req.method === 'GET') {
          await tokenVault.load();
          return json(200, { tokens: tokenVault.all(), persistence: tokenVault.available });
        }
        if (req.method !== 'POST') return json(405, { error: 'Метод не поддерживается.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'Ожидается JSON.' });
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) return json(413, { error: 'Запрос слишком большой.' }); }
        let body; try { body = JSON.parse(raw); } catch { return json(400, { error: 'Некорректный JSON.' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Ожидается объект.' });
        const client = req.headers['x-client-id'];
        if (typeof client !== 'string' || !/^[\w-]{16,80}$/.test(client)) return json(400, { error: 'Обновите страницу.' });
        if (req.url === '/api/verify') return json(200, { user: await verifier(body.token) });
        if (req.url === '/api/token-save') {
          if (typeof body.id !== 'string' || !accountIdPattern.test(body.id)) return json(400, { error: 'Укажите ID аккаунта.' });
          if (!validToken(body.token)) return json(400, { error: 'Введите корректный токен пользователя.' });
          const saved = await tokenVault.set(body.id, body.token);
          return json(200, { saved: saved !== false });
        }
        if (req.url === '/api/token-remove') {
          if (typeof body.id !== 'string' || !accountIdPattern.test(body.id)) return json(400, { error: 'Укажите ID аккаунта.' });
          const saved = await tokenVault.remove(body.id);
          return json(200, { saved: saved !== false });
        }
        if (req.url === '/api/start') { await verifier(body.token); accounts.start(body, client); }
        else if (['/api/stop', '/api/clear', '/api/remove'].includes(req.url)) accounts.act(req.url.slice(5), body.id, client);
        else if (req.url === '/api/stop-all') accounts.stopAll(client);
        else return json(404, { error: 'Маршрут не найден.' });
        return json(200, accounts.snapshot());
      }
      if (req.method !== 'GET') return json(405, { error: 'Метод не поддерживается.' });
      const file = files[req.url];
      if (!file) return json(404, { error: 'Не найдено.' });
      res.setHeader('Content-Type', `${file[1]}; charset=utf-8`);
      res.end(await readFile(new URL(`./public/${file[0]}`, import.meta.url)));
    } catch (error) {
      json(400, { error: error instanceof Error && error.message.startsWith('Сеанс') ? error.message : (error instanceof Error && /^(Введите|Укажите|ID |Интервал|Подтвердите)/.test(error.message) ? error.message : 'Не удалось обработать запрос.') });
    }
  });
  const lease = setInterval(() => accounts.checkLease(), 2000);
  lease.unref();
  server.on('close', () => { clearInterval(lease); accounts.stopAll(); });
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createApp();
  server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => console.log(`TradeDesk: http://127.0.0.1:${server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}
