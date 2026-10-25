import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TokenVault } from '../token-store.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('DPAPI helper round-trips tokens without plaintext on disk', { skip: process.platform !== 'win32' }, async () => {
  const windir = process.env.WINDIR || 'C:\\Windows';
  const framework64 = join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const framework32 = join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319');
  const framework = existsSync(join(framework64, 'csc.exe')) ? framework64 : framework32;
  const csc = join(framework, 'csc.exe');
  assert.ok(existsSync(csc), 'csc.exe is required for the Windows token helper test');

  const workspace = mkdtempSync(join(tmpdir(), 'tradedesk-dpapi-test-'));
  const helper = join(workspace, 'tokenstore.exe');
  const file = join(workspace, 'tokens.dat');
  try {
    execFileSync(csc, [
      '/nologo', '/target:exe', '/platform:anycpu', '/optimize+', '/codepage:65001',
      `/lib:${framework}`,
      `/r:${join(framework, 'System.dll')}`,
      `/r:${join(framework, 'System.Core.dll')}`,
      `/r:${join(framework, 'System.Security.dll')}`,
      `/out:${helper}`,
      join(root, 'installer', 'TokenStore.cs')
    ], { stdio: 'ignore' });

    const id = 'test-account-00000001';
    const token = `test_${'x'.repeat(28)}`;
    const first = new TokenVault({ helperPath: helper, filePath: file });
    assert.equal(first.available, true);
    await first.set(id, token);
    assert.equal(first.all()[id], token);
    const encrypted = readFileSync(file);
    assert.equal(encrypted.includes(Buffer.from(token, 'utf8')), false, 'token must not be stored as plaintext');

    const second = new TokenVault({ helperPath: helper, filePath: file });
    await second.load();
    assert.equal(second.all()[id], token);
    await second.remove(id);

    const third = new TokenVault({ helperPath: helper, filePath: file });
    await third.load();
    assert.deepEqual(third.all(), {});
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
