import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = (process.argv[2] || packageInfo.version || '').replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Некорректная версия: ${version}`);
const tag = `v${version}`;
const dist = join(root, 'dist');
const appOutput = process.env.TRADEDESK_APP_OUTPUT || join(root, 'dist', 'TradeDesk');
const zipPath = join(dist, 'TradeDesk-win-x64.zip');
const temporaryZip = zipPath + '.tmp';
const bootstrapPath = join(dist, 'TradeDeskBootstrap.exe');
const manifestPath = join(dist, 'latest.json');
const notesPath = join(dist, `release-notes-${version}.md`);

mkdirSync(dist, { recursive: true });
for (const path of [zipPath, temporaryZip, bootstrapPath, manifestPath, notesPath]) {
  rmSync(path, { force: true });
}

console.log('Сборка приложения…');
execFileSync(process.execPath, ['scripts/build-desktop.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TRADEDESK_OUTPUT: appOutput }
});

console.log('Сборка бутстрапера…');
execFileSync(process.execPath, ['scripts/build-bootstrapper.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TRADEDESK_BOOTSTRAPPER_OUTPUT: bootstrapPath }
});

console.log('Упаковка приложения…');
const zipScript = [
  '$ErrorActionPreference = "Stop";',
  'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
  'if (Test-Path -LiteralPath $env:TD_ZIP) { Remove-Item -LiteralPath $env:TD_ZIP -Force };',
  '[System.IO.Compression.ZipFile]::CreateFromDirectory($env:TD_SOURCE, $env:TD_ZIP, [System.IO.Compression.CompressionLevel]::Optimal, $false);'
].join(' ');
execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', zipScript], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TD_SOURCE: appOutput, TD_ZIP: temporaryZip }
});
if (!existsSync(temporaryZip)) throw new Error('ZIP не создан.');
renameSync(temporaryZip, zipPath);

const zipStat = statSync(zipPath);
const hash = await new Promise((resolveHash, rejectHash) => {
  const digest = createHash('sha256');
  const stream = readFileSync(zipPath);
  digest.update(stream);
  resolveHash(digest.digest('hex'));
});

const notes = [
  `# TradeDesk ${version}`,
  '',
  'Обновление TradeDesk.',
  '',
  '- Удаление аккаунта теперь подтверждается собственной адаптивной модальной панелью TradeDesk вместо системного диалога.',
  '- Установка без прав администратора в профиль пользователя.',
  '- Бутстрапер проверяет обновления, запускает приложение и удаляет его.',
  '- Токены Discord сохраняются зашифрованными через Windows DPAPI и не попадают в localStorage.',
  '- Тёмный адаптивный интерфейс, сохранение карточек, защита от повторного токена.',
  '- Ярлык TradeDesk с фирменной иконкой.',
  '',
  'Требования: Windows 10/11 x64 и Microsoft Edge WebView2 Runtime.',
  'Сборка не подписана: SmartScreen может запросить подтверждение.'
].join('\n');
writeFileSync(notesPath, notes + '\n', 'utf8');

const manifest = {
  version,
  tag,
  asset: 'TradeDesk-win-x64.zip',
  url: `https://github.com/niconexeder/TradeDesk/releases/download/${tag}/TradeDesk-win-x64.zip`,
  sha256: hash,
  size: zipStat.size,
  publishedAt: new Date().toISOString(),
  notes: `TradeDesk ${version}: кастомное подтверждение удаления и обновление интерфейса.`,
  minBootstrap: '1.0.0'
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const bootstrapStat = statSync(bootstrapPath);
console.log('');
console.log(`Версия: ${version}`);
console.log(`ZIP: ${zipPath} (${zipStat.size} байт)`);
console.log(`SHA-256: ${hash}`);
console.log(`Бутстрапер: ${bootstrapPath} (${bootstrapStat.size} байт)`);
console.log(`Манифест: ${manifestPath}`);
