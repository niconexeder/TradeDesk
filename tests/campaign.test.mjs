import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Campaign } from '../campaign.mjs';
const real = { message: 'Тест', interval: 60, channel: '123456789012345678', token: 'test-only-credential-'.repeat(2) };
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(fetcher = async () => ({ ok: true })) {
  let now = 100000, callback, delay;
  const c = new Campaign({ fetcher, clock: () => now, schedule: (cb, ms) => { callback = cb; delay = ms; return 1; }, cancel: () => { callback = null; } });
  return { c, tick: ms => { now += ms; }, fire: () => callback?.(), delay: () => delay };
}
test('multiple channels rotate one per interval, deduplicate and retain position on 429', async () => {
  const urls = []; let limited = true;
  const f = fixture(async url => { urls.push(url); if (urls.length === 2 && limited) { limited = false; return { status: 429, json: async () => ({ retry_after: 2 }) }; } return { ok: true }; });
  const channels = ['123456789012345678', '987654321098765432'];
  f.c.start({ ...real, channels: [...channels, channels[0]] }); await flush();
  for (let i = 0; i < 3; i++) { f.tick(60000); f.c.heartbeat(); f.fire(); await flush(); }
  assert.deepEqual(urls.map(url => url.split('/')[6]), [channels[0], channels[1], channels[1], channels[0]]);
  assert.equal(f.c.sent, 3); f.c.stop();
  for (const channels of [[], ['bad'], Array(21).fill('123456789012345678')]) assert.throws(() => f.c.start({ ...real, channels }));
});
test('sends immediately, respects cooldown and stops', async () => {
  let calls = 0; const f = fixture(async () => { calls++; return { ok: true }; });
  f.c.start(real); await flush(); assert.equal(f.c.sent, 1); assert.equal(f.delay(), 60000);
  f.tick(60000); f.c.heartbeat(); f.fire(); await flush(); assert.equal(f.c.sent, 2); assert.equal(calls, 2);
  f.c.stop(); f.fire(); assert.equal(f.c.sent, 2); assert.equal(f.c.token, ''); assert.equal(f.c.nextAt, null);
});
test('validates real requests without requiring demo or consent flags', async () => {
  const { c } = fixture();
  for (const input of [{ ...real, channel: 'x' }, { ...real, interval: 5 }, { ...real, token: 'Bot abcdefghijklmnopqrstuvwxyz' }, { ...real, message: '' }, { ...real, interval: NaN }, { ...real, message: 'a'.repeat(2001) }, { demo: true, message: 'x', interval: 5 }]) assert.throws(() => c.start(input));
  c.start(real); await flush(); assert.equal(c.sent, 1); c.stop();
});
test('sending uses user auth, disables mentions, and never exposes token in snapshot', async () => {
  let request; const { c } = fixture(async (url, options) => { request = { url, options }; return { ok: true, status: 200 }; });
  c.start(real); await flush();
  assert.equal(request.options.headers.Authorization, real.token);
  assert.deepEqual(JSON.parse(request.options.body).allowed_mentions, { parse: [] });
  assert.equal(c.sent, 1); assert.ok(!JSON.stringify(c.snapshot()).includes(real.token)); assert.ok(!('demo' in c.snapshot())); c.stop(); assert.equal(c.token, '');
});
test('429 waits for Discord retry_after and never loops immediately', async () => {
  const f = fixture(async () => ({ ok: false, status: 429, json: async () => ({ retry_after: 120 }) }));
  f.c.start(real); await flush(); assert.equal(f.delay(), 121000); assert.equal(f.c.sent, 0); assert.equal(f.c.running, true); f.c.stop();
});
for (const status of [400, 401, 403, 404, 500]) test(`Discord ${status} stops and clears token`, async () => {
  const { c } = fixture(async () => ({ ok: false, status })); c.start(real); await flush();
  assert.equal(c.running, false); assert.equal(c.token, ''); assert.equal(c.sent, 0);
});
test('network failure does not blindly retry an uncertain send', async () => {
  const { c } = fixture(async () => { throw new Error(real.token); }); c.start(real); await flush();
  assert.equal(c.running, false); assert.ok(!JSON.stringify(c.snapshot()).includes(real.token));
});
test('stopping during in-flight request cannot schedule a new send', async () => {
  let resolve; const f = fixture(() => new Promise(r => resolve = r)); f.c.start(real); f.c.stop();
  resolve({ ok: true, status: 200 }); await flush(); assert.equal(f.c.sent, 0); assert.equal(f.c.running, false); assert.equal(f.c.nextAt, null);
});
test('lost owner heartbeat stops campaign', async () => {
  const f = fixture(); f.c.start(real); await flush(); f.tick(16000); f.c.checkLease(); assert.equal(f.c.running, false);
});
test('logs are bounded and repeated start is rejected', async () => {
  const { c } = fixture(); c.start(real); assert.throws(() => c.start(real)); await flush();
  for (let i = 0; i < 150; i++) c.log('test'); assert.equal(c.events.length, 100); c.stop();
});
