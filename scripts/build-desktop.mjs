import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(root, 'desktop', 'TradeDesk.Desktop.csproj');
const output = process.env.TRADEDESK_OUTPUT
  ? resolve(process.env.TRADEDESK_OUTPUT)
  : join(root, 'dist', 'TradeDesk');
const icon = join(root, 'desktop', 'TradeDesk.ico');

if (!existsSync(icon)) throw new Error(`Не найдена иконка: ${icon}`);
if (!existsSync(join(root, 'public', 'index.html'))) throw new Error('Не найдена папка public с интерфейсом.');

const nodeExe = process.execPath;
if (!nodeExe.toLowerCase().endsWith('node.exe')) {
  throw new Error(`Сборку нужно запускать через node.exe, а не через ${nodeExe}`);
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

execFileSync('dotnet', [
  'publish', project,
  '-c', 'Release',
  '-r', 'win-x64',
  '--self-contained', 'true',
  '-o', output,
  '--nologo'
], { cwd: root, stdio: 'inherit' });

const runtimeDirectory = join(output, 'runtime');
mkdirSync(runtimeDirectory, { recursive: true });
copyFileSync(nodeExe, join(runtimeDirectory, 'node.exe'));

const appDirectory = join(output, 'app');
mkdirSync(appDirectory, { recursive: true });
for (const file of ['server.mjs', 'accounts.mjs', 'auth.mjs', 'campaign.mjs', 'token-store.mjs']) {
  copyFileSync(join(root, file), join(appDirectory, file));
}
cpSync(join(root, 'public'), join(appDirectory, 'public'), { recursive: true });

const windir = process.env.WINDIR || 'C:\\Windows';
const framework64 = join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const framework32 = join(windir, 'Microsoft.NET', 'Framework', 'v4.0.30319');
const framework = existsSync(join(framework64, 'csc.exe')) ? framework64 : framework32;
const csc = join(framework, 'csc.exe');
if (!existsSync(csc)) throw new Error(`Не найден csc.exe: ${csc}`);
const tokenOutput = join(appDirectory, 'tokenstore.exe');
execFileSync(csc, [
  '/nologo', '/target:exe', '/platform:anycpu', '/optimize+', '/codepage:65001',
  `/lib:${framework}`,
  `/r:${join(framework, 'System.dll')}`,
  `/r:${join(framework, 'System.Core.dll')}`,
  `/r:${join(framework, 'System.Security.dll')}`,
  `/out:${tokenOutput}`,
  join(root, 'installer', 'TokenStore.cs')
], { cwd: root, stdio: 'inherit' });

writeFileSync(join(output, 'README.txt'), `TradeDesk — локальная панель публикации объявлений в Discord.

Запуск
------
Откройте ярлык TradeDesk на рабочем столе. Ярлык запускает TradeDeskBootstrap.exe:
он проверяет обновления и открывает приложение. Не перемещайте файлы из папки установки.

Требования
----------
Windows 10/11 x64 и Microsoft Edge WebView2 Runtime. Если WebView2 не установлен,
приложение предложит открыть страницу загрузки.

Первый запуск
-------------
Сборка не подписана. Windows SmartScreen может попросить подтверждение:
"Подробнее" -> "Выполнить в любом случае", если файл получен из официального
релиза на github.com/niconexeder/TradeDesk.

Данные
------
Настройки карточек хранятся в профиле WebView2:
%LOCALAPPDATA%\\TradeDesk\\WebView2
Токены сохраняются зашифрованными в %LOCALAPPDATA%\\TradeDesk\\data\\tokens.dat
(Windows DPAPI, только для текущего пользователя Windows). Они не попадают в
localStorage и журнал. При удалении карточки её токен удаляется. Удаление
TradeDesk через "Приложения и возможности" удаляет настройки, токены и профиль.

Один и тот же токен нельзя подключить в двух карточках.

Пересборка из исходников
------------------------
В папке проекта: node scripts/build-release.mjs
`);

console.log(`Готово: ${join(output, 'TradeDesk.exe')}`);
