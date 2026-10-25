import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = join(root, 'desktop', 'TradeDesk.Desktop.csproj');
const output = process.env.TRADEDESK_OUTPUT
  ? resolve(root, process.env.TRADEDESK_OUTPUT)
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
for (const file of ['server.mjs', 'accounts.mjs', 'auth.mjs', 'campaign.mjs']) {
  copyFileSync(join(root, file), join(appDirectory, file));
}
cpSync(join(root, 'public'), join(appDirectory, 'public'), { recursive: true });

writeFileSync(join(output, 'README.txt'), `TradeDesk — локальная панель публикации объявлений в Discord.

Запуск
------
Откройте TradeDesk.exe. Не перемещайте exe отдельно от папки: рядом должны
оставаться каталоги app и runtime.

Требования
----------
Windows 10/11 x64 и Microsoft Edge WebView2 Runtime. Если WebView2 не установлен,
приложение предложит открыть страницу загрузки.

Первый запуск
-------------
Сборка не подписана. Windows SmartScreen может попросить подтверждение:
"Подробнее" -> "Выполнить в любом случае", если приложение получено из
доверенного источника.

Данные
------
Настройки карточек хранятся в профиле WebView2:
%LOCALAPPDATA%\\TradeDesk\\WebView2
Токены не сохраняются на диск. Поле токена остаётся заполненным до закрытия
приложения или удаления карточки; сервер удаляет свою копию токена при остановке.
Один и тот же токен нельзя подключить в двух карточках.

Пересборка из исходников
------------------------
В папке проекта: node scripts/build-desktop.mjs
`);

console.log(`Готово: ${join(output, 'TradeDesk.exe')}`);
