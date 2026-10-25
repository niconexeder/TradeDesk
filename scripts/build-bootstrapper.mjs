import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const windir = process.env.WINDIR || 'C:\\Windows';
const framework64 = join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const framework32 = join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319');
const framework = existsSync(join(framework64, 'csc.exe')) ? framework64 : framework32;
const csc = join(framework, 'csc.exe');
if (!existsSync(csc)) throw new Error(`Не найден csc.exe: ${csc}`);
const output = process.env.TRADEDESK_BOOTSTRAPPER_OUTPUT
  ? resolve(process.env.TRADEDESK_BOOTSTRAPPER_OUTPUT)
  : join(root, 'dist', 'TradeDeskBootstrap.exe');
mkdirSync(dirname(output), { recursive: true });

const references = [
  'System.dll',
  'System.Core.dll',
  'System.Drawing.dll',
  'System.Windows.Forms.dll',
  'System.IO.Compression.dll',
  'System.IO.Compression.FileSystem.dll',
  'System.Net.Http.dll',
  'System.Web.Extensions.dll',
  'Microsoft.CSharp.dll'
].map(name => `/r:${join(framework, name)}`);

execFileSync(csc, [
  '/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/codepage:65001',
  `/lib:${framework}`,
  ...references,
  `/win32icon:${join(root, 'desktop', 'TradeDesk.ico')}`,
  `/out:${output}`,
  join(root, 'installer', 'Bootstrapper.cs')
], { cwd: root, stdio: 'inherit' });

console.log(`Бутстрапер: ${output}`);
