import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyToken } from '../auth.mjs';
const token = 'test-token-'.repeat(4);
test('verification reads profile only, returns safe identity and avatar, never returns credentials', async () => {
  let request;
  const user = await verifyToken(token, async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ id: '123456789012345678', username: 'tester', global_name: 'Tester', avatar: '0123456789abcdef0123456789abcdef', email: 'private@example.com' }) }; });
  assert.equal(request.url, 'https://discord.com/api/v10/users/@me');
  assert.equal(request.options.headers.Authorization, token);
  assert.deepEqual(user, { id: '123456789012345678', username: 'tester', displayName: 'Tester', avatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/0123456789abcdef0123456789abcdef.png?size=80' });
  assert.ok(!JSON.stringify(user).includes(token));
});
test('avatar URL supports animated avatars and Discord default avatars', async () => {
  const profile = data => async () => ({ ok: true, json: async () => data });
  const animated = await verifyToken(token, profile({ id: '123456789012345678', username: 'tester', avatar: 'a_0123456789abcdef0123456789abcdef' }));
  assert.equal(animated.avatarUrl, 'https://cdn.discordapp.com/avatars/123456789012345678/a_0123456789abcdef0123456789abcdef.gif?size=80');
  const fallback = await verifyToken(token, profile({ id: '123456789012345678', username: 'tester' }));
  assert.equal(fallback.avatarUrl, 'https://cdn.discordapp.com/embed/avatars/0.png');
  const invalid = await verifyToken(token, profile({ id: '123456789012345678', username: 'tester', avatar: 'not a hash' }));
  assert.match(invalid.avatarUrl, /^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
});
test('verification rejects invalid, bot, limited and network responses without leaking token', async () => {
  await assert.rejects(verifyToken('short'), /Введите/);
  for (const status of [401, 403, 429, 500]) await assert.rejects(verifyToken(token, async () => ({ ok: false, status })), /Введите/);
  await assert.rejects(verifyToken(token, async () => ({ ok: true, json: async () => ({ id: '1', username: 'bot', bot: true }) })), /не бота/);
  await assert.rejects(verifyToken(token, async () => { throw new Error(token); }), error => !error.message.includes(token));
});
