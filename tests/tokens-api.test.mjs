import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { Accounts } from '../accounts.mjs';
import { Campaign } from '../campaign.mjs';

function memoryVault() {
  const tokens = Object.create(null);
  return {
    available: true,
    tokens,
    async load() {},
    all() { return { ...tokens }; },
    async set(id, token) { tokens[id] = token; return true; },
    async remove(id) { delete tokens[id]; return true; }
  };
}

test('token API persists tokens only with the local key and never leaks them in status', async t => {
  const vault = memoryVault();
  const accounts = new Accounts(() => new Campaign({ fetcher: async () => ({ ok: true }) }));
  const server = createApp(accounts, async () => ({ id: '123456789012345678', username: 'test' }), vault);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const { key } = await (await fetch(`${url}/api/session`)).json();
  const headers = { 'X-Local-Key': key, 'Content-Type': 'application/json', 'X-Client-Id': 'integration-client-123' };
  const id = 'account-000000001';
  const token = 'a'.repeat(30);

  assert.equal((await fetch(`${url}/api/tokens`)).status, 403);
  assert.deepEqual(await (await fetch(`${url}/api/tokens`, { headers })).json(), { tokens: {}, persistence: true });

  const saved = await fetch(`${url}/api/token-save`, { method: 'POST', headers, body: JSON.stringify({ id, token }) });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.deepEqual(savedBody, { saved: true });
  assert.ok(!JSON.stringify(savedBody).includes(token));
  assert.deepEqual(await (await fetch(`${url}/api/tokens`, { headers })).json(), { tokens: { [id]: token }, persistence: true });

  const status = await (await fetch(`${url}/api/status`, { headers })).json();
  assert.ok(!JSON.stringify(status).includes(token));

  assert.equal((await fetch(`${url}/api/token-save`, { method: 'POST', headers, body: JSON.stringify({ id: 'bad', token }) })).status, 400);
  assert.equal((await fetch(`${url}/api/token-save`, { method: 'POST', headers, body: JSON.stringify({ id, token: 'short' }) })).status, 400);

  const removed = await fetch(`${url}/api/token-remove`, { method: 'POST', headers, body: JSON.stringify({ id }) });
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { saved: true });
  assert.deepEqual(await (await fetch(`${url}/api/tokens`, { headers })).json(), { tokens: {}, persistence: true });
});
