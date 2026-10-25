import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const bootstrapper = join(root, 'dist', 'TradeDeskBootstrap.exe');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function zipDirectory(source, destination) {
  const script = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    'if (Test-Path -LiteralPath $env:TD_ZIP) { Remove-Item -LiteralPath $env:TD_ZIP -Force };',
    '[System.IO.Compression.ZipFile]::CreateFromDirectory($env:TD_SRC, $env:TD_ZIP, [System.IO.Compression.CompressionLevel]::Optimal, $false)'
  ].join(' ');
  execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    env: { ...process.env, TD_SRC: source, TD_ZIP: destination },
    stdio: 'inherit'
  });
}

function makePayload(directory, marker) {
  mkdirSync(join(directory, 'app'), { recursive: true });
  mkdirSync(join(directory, 'runtime'), { recursive: true });
  writeFileSync(join(directory, 'TradeDesk.exe'), `fake app ${marker}`);
  writeFileSync(join(directory, 'app', 'server.mjs'), `// ${marker}`);
  writeFileSync(join(directory, 'runtime', 'node.exe'), `fake runtime ${marker}`);
}

async function startAssets() {
  const assets = new Map();
  const server = http.createServer((request, response) => {
    const asset = assets.get(request.url);
    if (!asset) {
      response.writeHead(404);
      response.end('missing');
      return;
    }
    response.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.length });
    response.end(asset.body);
  });
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    assets,
    close: () => new Promise(resolveClose => { server.close(resolveClose); server.closeAllConnections(); })
  };
}

function addRelease(assets, base, version, payloadDirectory) {
  const zip = join(payloadDirectory, '..', `${version}.zip`);
  zipDirectory(payloadDirectory, zip);
  const body = readFileSync(zip);
  const manifest = {
    version,
    tag: `v${version}`,
    asset: 'TradeDesk-win-x64.zip',
    url: `${base}/payload-${version}.zip`,
    sha256: sha256(body),
    size: body.length,
    publishedAt: new Date().toISOString(),
    notes: `test ${version}`,
    minBootstrap: '1.0.0'
  };
  assets.set(`/payload-${version}.zip`, { body, type: 'application/zip' });
  assets.set('/latest.json', { body: Buffer.from(JSON.stringify(manifest)), type: 'application/json' });
  return manifest;
}

function runBootstrapper(args, environment = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(bootstrapper, args, {
      env: { ...process.env, TRADEDESK_BOOTSTRAP_TEST: '1', ...environment }
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      rejectRun(new Error(`bootstrapper timed out: ${args.join(' ')}`));
    }, 120000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.on('close', status => {
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr });
    });
  });
}

test('bootstrapper installs, updates atomically, rejects bad hashes, and uninstalls', async t => {
  if (!existsSync(bootstrapper)) {
    execFileSync(process.execPath, ['scripts/build-bootstrapper.mjs'], { cwd: root, stdio: 'inherit' });
  }
  assert.ok(existsSync(bootstrapper), 'bootstrapper was not built');

  const workspace = mkdtempSync(join(tmpdir(), 'tradedesk-bootstrap-test-'));
  const payloadV1 = join(workspace, 'payload-v1');
  const payloadV2 = join(workspace, 'payload-v2');
  const target = join(workspace, 'installed');
  const badTarget = join(workspace, 'bad-target');
  makePayload(payloadV1, 'v1');
  makePayload(payloadV2, 'v2');
  mkdirSync(join(target, 'runtime'), { recursive: true });
  writeFileSync(join(target, 'TradeDesk.exe'), 'legacy app');
  writeFileSync(join(target, 'runtime', 'legacy.txt'), 'legacy runtime');
  const assets = await startAssets();
  t.after(async () => {
    await assets.close();
    rmSync(workspace, { recursive: true, force: true });
  });
  const manifestV1 = addRelease(assets.assets, assets.url, '1.0.0', payloadV1);

  const run = extra => runBootstrapper([
    '--silent', '--target', target, '--manifest', `${assets.url}/latest.json`, '--no-shortcut', '--no-launch', ...extra
  ]);

  const installed = await run([]);
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  assert.equal(readFileSync(join(target, 'app', 'TradeDesk.exe'), 'utf8'), 'fake app v1');
  assert.equal(readFileSync(join(target, 'version.txt'), 'utf8').trim(), '1.0.0');
  assert.equal(readFileSync(join(target, 'app', 'runtime', 'node.exe'), 'utf8'), 'fake runtime v1');
  assert.equal(existsSync(join(target, 'TradeDesk.exe')), false);
  assert.equal(existsSync(join(target, 'runtime')), false);

  mkdirSync(join(target, 'data'), { recursive: true });
  writeFileSync(join(target, 'data', 'keep.txt'), 'preserve me');
  addRelease(assets.assets, assets.url, '1.0.1', payloadV2);
  const updated = await run([]);
  assert.equal(updated.status, 0, updated.stderr || updated.stdout);
  assert.equal(readFileSync(join(target, 'app', 'TradeDesk.exe'), 'utf8'), 'fake app v2');
  assert.equal(readFileSync(join(target, 'version.txt'), 'utf8').trim(), '1.0.1');
  assert.equal(readFileSync(join(target, 'data', 'keep.txt'), 'utf8'), 'preserve me');

  const badManifest = addRelease(assets.assets, assets.url, '1.0.2', payloadV1);
  badManifest.sha256 = '0'.repeat(64);
  assets.assets.set('/latest.json', { body: Buffer.from(JSON.stringify(badManifest)), type: 'application/json' });
  const bad = await runBootstrapper([
    '--silent', '--target', badTarget, '--manifest', `${assets.url}/latest.json`, '--no-shortcut', '--no-launch'
  ]);
  assert.notEqual(bad.status, 0);
  assert.equal(existsSync(join(badTarget, 'app', 'TradeDesk.exe')), false);

  const failedUpdate = await run([]);
  assert.notEqual(failedUpdate.status, 0);
  assert.equal(readFileSync(join(target, 'app', 'TradeDesk.exe'), 'utf8'), 'fake app v2');
  assert.equal(readFileSync(join(target, 'version.txt'), 'utf8').trim(), '1.0.1');
  assert.equal(readFileSync(join(target, 'data', 'keep.txt'), 'utf8'), 'preserve me');

  const removed = await runBootstrapper([
    '--silent', '--uninstall', '--target', target, '--no-launch'
  ]);
  assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  const deadline = Date.now() + 5000;
  while (existsSync(target) && Date.now() < deadline) {
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assert.equal(existsSync(target), false);
});
