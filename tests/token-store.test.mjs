import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TokenVault } from '../token-store.mjs';

const id = 'account-000000001';
const token = 'a'.repeat(30);

function fakeStore(initial = '{}') {
  let stored = initial;
  const calls = [];
  return {
    calls,
    get stored() { return stored; },
    runner: async (helper, args, input) => {
      calls.push({ helper, args, input });
      if (args[0] === 'read') return stored;
      if (args[0] === 'write') { stored = input; return ''; }
      throw new Error('unknown helper command');
    }
  };
}

test('TokenVault saves, reloads and removes tokens through the helper', async () => {
  const store = fakeStore();
  const vault = new TokenVault({ helperPath: 'tokenstore.exe', filePath: 'tokens.dat', helperExists: () => true, runner: store.runner });
  await vault.load();
  assert.deepEqual(vault.all(), {});
  assert.equal(await vault.set(id, token), true);
  assert.deepEqual(vault.all(), { [id]: token });
  const write = store.calls.find(call => call.args[0] === 'write');
  assert.ok(write);
  assert.match(write.input, new RegExp(token));

  const restarted = new TokenVault({ helperPath: 'tokenstore.exe', filePath: 'tokens.dat', helperExists: () => true, runner: store.runner });
  await restarted.load();
  assert.deepEqual(restarted.all(), { [id]: token });

  assert.equal(await restarted.remove(id), true);
  assert.deepEqual(restarted.all(), {});
  const empty = new TokenVault({ helperPath: 'tokenstore.exe', filePath: 'tokens.dat', helperExists: () => true, runner: store.runner });
  await empty.load();
  assert.deepEqual(empty.all(), {});
});

test('TokenVault rejects bad IDs and tokens and ignores malformed saved entries', async () => {
  const store = fakeStore(JSON.stringify({ bad: token, [id]: token, 'account-000000002': 'short', 'account-000000003': 'b'.repeat(30) }));
  const vault = new TokenVault({ helperPath: 'tokenstore.exe', filePath: 'tokens.dat', helperExists: () => true, runner: store.runner });
  await vault.load();
  assert.deepEqual(vault.all(), { [id]: token, 'account-000000003': 'b'.repeat(30) });
  await assert.rejects(() => vault.set('bad', token), /ID/);
  await assert.rejects(() => vault.set(id, 'short'), /токен/i);
  await assert.rejects(() => vault.set(id, 'a'.repeat(20) + ' ' + 'a'.repeat(10)), /токен/i);
});

test('TokenVault does not claim persistence when the helper is missing', async () => {
  let calls = 0;
  const vault = new TokenVault({ helperPath: 'missing.exe', filePath: 'tokens.dat', helperExists: () => false, runner: async () => { calls++; return '{}'; } });
  await vault.load();
  assert.equal(await vault.set(id, token), false);
  assert.deepEqual(vault.all(), {});
  assert.equal(calls, 0);
});
