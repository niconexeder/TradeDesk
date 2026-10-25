import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const payloadSource = process.env.TRADEDESK_PAYLOAD
  ? resolve(process.env.TRADEDESK_PAYLOAD)
  : join(root, 'dist', 'TradeDesk');
const output = process.env.TRADEDESK_BOOTSTRAPPER_OUTPUT
  ? resolve(process.env.TRADEDESK_BOOTSTRAPPER_OUTPUT)
  : join(root, 'dist', 'TradeDeskSetup.exe');
const buildDirectory = process.env.TRADEDESK_BOOTSTRAPPER_BUILD
  ? resolve(process.env.TRADEDESK_BOOTSTRAPPER_BUILD)
  : join(root, 'installer', 'build');
const source = join(root, 'installer', 'Bootstrapper.cs');
const icon = join(root, 'desktop', 'TradeDesk.ico');
const payloadZip = join(buildDirectory, 'TradeDeskPayload.zip');
const windir = process.env.WINDIR || 'C:\\Windows';
const framework64 = join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const framework32 = join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319');
const framework = existsSync(join(framework64, 'csc.exe')) ? framework64 : framework32;
const csc = join(framework, 'csc.exe');

if (!existsSync(source)) throw new Error(`Bootstrapper source not found: ${source}`);
if (!existsSync(icon)) throw new Error(`Icon not found: ${icon}`);
if (!existsSync(join(payloadSource, 'TradeDesk.exe'))) {
  throw new Error(`Application payload not found: ${payloadSource}`);
}

mkdirSync(buildDirectory, { recursive: true });
mkdirSync(dirname(output), { recursive: true });
rmSync(payloadZip, { force: true });

console.log(`Packing ${payloadSource} ...`);
const archiveCommand = [
  'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
  'if (Test-Path -LiteralPath $env:TD_ZIP) { Remove-Item -LiteralPath $env:TD_ZIP -Force };',
  '[System.IO.Compression.ZipFile]::CreateFromDirectory(',
  '$env:TD_SRC, $env:TD_ZIP,',
  '[System.IO.Compression.CompressionLevel]::Optimal, $false)'
].join(' ');
execFileSync('powershell.exe', [
  '-NoLogo',
  '-NoProfile',
  '-ExecutionPolicy',
  'Bypass',
  '-Command',
  archiveCommand
], {
  cwd: root,
  env: { ...process.env, TD_SRC: payloadSource, TD_ZIP: payloadZip },
  stdio: 'inherit'
});

const references = [
  'System.dll',
  'System.Core.dll',
  'System.Windows.Forms.dll',
  'System.Drawing.dll',
  'System.IO.Compression.dll',
  'System.IO.Compression.FileSystem.dll',
  'Microsoft.CSharp.dll'
];
const cscArguments = [
  '/nologo',
  '/target:winexe',
  '/platform:anycpu',
  '/optimize+',
  '/codepage:65001',
  `/lib:${framework}`,
  ...references.map(reference => `/r:${join(framework, reference)}`),
  `/win32icon:${icon}`,
  `/resource:${payloadZip},TradeDeskPayload.zip`,
  `/out:${output}`,
  source
];

console.log('Compiling TradeDeskSetup.exe ...');
execFileSync(csc, cscArguments, { cwd: root, stdio: 'inherit' });

if (!existsSync(output)) throw new Error(`Bootstrapper was not created: ${output}`);
console.log(`Bootstrapper: ${output}`);
console.log(`Payload: ${(statSync(payloadZip).size / 1024 / 1024).toFixed(2)} MB`);
console.log(`Setup: ${(statSync(output).size / 1024 / 1024).toFixed(2)} MB`);
