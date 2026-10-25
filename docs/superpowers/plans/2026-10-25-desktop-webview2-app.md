# TradeDesk Desktop (WebView2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ship TradeDesk as a folder-based Windows application (`TradeDesk.exe`) that hosts the existing web UI in Microsoft WebView2, runs the existing Node backend as a hidden child process, and rejects identical user tokens in multiple account cards.

**Architecture:** A small C# WinForms host owns the native window, starts a bundled `runtime/node.exe` with a fixed loopback port, loads `http://127.0.0.1:47831/` in WebView2, and kills the backend on close. The Node backend and web UI stay the source of truth. Duplicate token rejection is added to the card UI, with the existing server-side running-token guard retained as defense in depth.

**Tech Stack:** C# / .NET 8 WinForms, Microsoft.Web.WebView2, Node.js 26, vanilla HTML/CSS/JS.

**Spec:** `docs/superpowers/plans/2026-10-25-desktop-webview2-app.md` (the approved chat plan is reproduced here).

## Global Constraints

- Windows 10/11 x64.
- Application folder must include `TradeDesk.exe`, .NET files, `runtime/node.exe`, and `app/` backend.
- No console window may appear when launched normally.
- WebView2 Runtime is a system prerequisite; show a clear message and download link if absent.
- The local server must use a fixed loopback port `47831` so WebView2 localStorage survives restarts.
- Tokens remain memory-only and are never written to disk or localStorage.
- Duplicate comparison is exact after trimming surrounding whitespace, within the current app session.
- Only the UI design is carried over; no visual redesign is planned.
- All existing Node tests must keep passing.

## Review Focus

- Duplicate token entered in a second card must be blocked before Discord verification, and must unblock automatically when the first card's token changes or is removed.
- Closing the native window must terminate the bundled Node server, including when startup is still in progress.
- `TradeDesk.exe` must not open an external browser or a second app instance.
- If `runtime/node.exe`, `app/server.mjs`, or WebView2 Runtime is missing, the app must fail with a clear message rather than a silent blank window.
- Desktop settings must survive restart while tokens do not.

---

### Task 1: Add duplicate-token guard to the web UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`
- Test: browser automation against a temporary mock backend

**Interfaces:**
- Produces: each card's token state is evaluated by one function; `c.duplicateBlocked` marks cards waiting for a duplicate to clear; top-level `refreshDuplicatePeers(exclude)` retries blocked cards.

- [x] **Step 1: Add the failing UI scenario**

Open two cards, enter the same 30+ character token in both, and assert that the second card shows `Этот токен уже используется в другой карточке.`, hides `.settings`, and hides `.start`.

- [x] **Step 2: Implement duplicate detection**

In `addCard`, add `c.authTimer`, `c.duplicateBlocked`, a `duplicateOwner()` that compares `inputs.token.value.trim()` against every other card, and a `refreshToken()` that clears stale verification, blocks duplicates, or schedules the existing Discord verification.

- [x] **Step 3: Revalidate peers**

On token input and card removal, call `refreshDuplicatePeers(card)` so a card that was blocked by a duplicate is verified automatically after the first token changes or disappears.

- [x] **Step 4: Update copy**

Add `Один токен — одна карточка.` to the token hint. Update page/help/privacy copy from “до перезагрузки страницы” to “до закрытия приложения или вкладки”.

- [x] **Step 5: Run Node tests and the browser scenario**

Run `node --test tests/*.test.mjs`; expect 21/21 pass. Run the duplicate-token browser scenario; expect the second card blocked and no settings/start button.

### Task 2: Create the C# WebView2 host

**Files:**
- Create: `desktop/TradeDesk.Desktop.csproj`
- Create: `desktop/Program.cs`
- Create: `desktop/MainForm.cs`
- Create: `desktop/app.manifest`
- Create: `desktop/TradeDesk.ico`

**Interfaces:**
- `Program.Main(string[] args)` creates a single-instance mutex and runs `new MainForm(args.Contains("--debug"))`.
- `MainForm` starts `runtime/node.exe app/server.mjs` with `PORT=47831`, parses `TradeDesk: http://127.0.0.1:47831` from stdout, and navigates WebView2 there.
- `MainForm` denies non-local navigation, popups, and permission requests; hides its loading label after navigation.

- [x] **Step 1: Add the WinForms project and manifest**

Target `net8.0-windows`, `WinExe`, x64, self-contained publish, `Microsoft.Web.WebView2` `1.0.3967.48`, PerMonitorV2 DPI.

- [x] **Step 2: Implement the single-instance program**

Use `Local\TradeDesk.Desktop.SingleInstance`; if already running, restore the existing window and exit.

- [x] **Step 3: Implement WebView2 startup and shutdown**

Check WebView2 availability, create a persistent user-data folder under `%LOCALAPPDATA%\TradeDesk\WebView2`, start the hidden Node process, wait for the loopback URL with a 20-second timeout, and dispose/kill everything in `FormClosing`.

- [x] **Step 4: Implement native polish**

Dark title bar via DWM attribute 20, app icon, 1280×860 centered window, minimum 880×640, dark loading screen, fixed port 47831.

- [x] **Step 5: Build the shell**

Run `dotnet build desktop/TradeDesk.Desktop.csproj -c Release`; expect success and `WebView2Loader.dll` in the output.

### Task 3: Add the distribution build script

**Files:**
- Create: `scripts/build-desktop.mjs`
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `dist/TradeDesk/README.txt` (generated)

**Interfaces:**
- `node scripts/build-desktop.mjs` publishes the C# project to `dist/TradeDesk`, copies `process.execPath` to `runtime/node.exe`, copies backend files to `app/`, and writes a run README.

- [x] **Step 1: Write the build script**

Use `dotnet publish ... -r win-x64 --self-contained true -o dist/TradeDesk`, then copy `server.mjs`, `accounts.mjs`, `auth.mjs`, `campaign.mjs`, and `public/`.

- [x] **Step 2: Add housekeeping**

Add `dist/`, `desktop/bin/`, `desktop/obj/` to `.gitignore`; add `build:desktop` to `package.json`.

- [x] **Step 3: Build the folder**

Run `node scripts/build-desktop.mjs`; expect `dist/TradeDesk/TradeDesk.exe`, `dist/TradeDesk/runtime/node.exe`, and `dist/TradeDesk/app/server.mjs`.

### Task 4: Update documentation

**Files:**
- Modify: `README.md`

- [x] **Step 1: Document desktop usage**

Describe the folder, launch, WebView2 runtime, fixed local port, persistent settings, token non-persistence, duplicate-token rule, and rebuild command.

- [x] **Step 2: Keep web development instructions**

Keep `npm start` / `node server.mjs` and the test command for development.

### Task 5: Verify the shipped application

**Files:**
- No source changes expected.

- [x] **Step 1: Verify the .exe starts**

Launch `dist/TradeDesk/TradeDesk.exe --debug`; expect one native window titled `TradeDesk — аккаунты`, WebView2 page connected, no console window.

- [x] **Step 2: Verify duplicate-token UX in the app**

Through WebView2 CDP, add a second card and enter the same fake token in both; expect the second card blocked, settings and start hidden.

- [x] **Step 3: Verify persistence and token privacy**

Change a channel/interval field, close the app, relaunch, and confirm the setting persists while the token field is empty.

- [x] **Step 4: Verify shutdown and single instance**

Close the app; expect the Node child process and port 47831 to disappear. Launch twice; expect only one `TradeDesk` process.

- [x] **Step 5: Run the full regression suite**

Run `node --test tests/*.test.mjs`; expect 21/21 pass. Re-run the browser mock check for token retention after start/stop/restart.

## Execution Record

- `node --test tests/*.test.mjs`: 21/21 passed.
- Duplicate-token browser scenario: second card blocked; auto-unblock after first token change and after first card removal; no console errors.
- WebView2 desktop scenario: page loaded at `http://127.0.0.1:47831/`; duplicate token blocked; native window present; backend port closed after close.
- Persistence scenario: settings restored after restart; token empty; single instance kept one process; backend port closed after each close.
- Token retention scenario: token survived start, stop, and restart; avatar loaded; no horizontal overflow; no console errors.
- Native window screenshot: dark title bar, app icon, fixed-size layout, dark scrollbar.
- `dotnet build` and `node scripts/build-desktop.mjs`: zero warnings/errors.
- Distribution folder: `dist/TradeDesk/` with `TradeDesk.exe`, `runtime/node.exe`, `app/server.mjs`.

### Final polish

- Added dark `::-webkit-scrollbar` styling and reset scroll to the top on the first WebView2 navigation.
- Clamped the initial window size to the primary screen working area.
- Passed Chromium flags that keep WebView2 timers and rendering active when the window is occluded or minimized. Verified with a 12-second minimized-window timer test (17 ticks, no throttle) and clean backend shutdown.
- Added a friendly fixed-port conflict message.
- Stopped the Node server from `Dispose` as a second cleanup path.
- Updated desktop/user README copy: build requirements, fixed port, WebView2, SmartScreen, token non-persistence, duplicate-token behavior, and web-mode limitations.
- Removed web-only references from in-app server errors.
- Rebuilt and re-tested the final `dist/TradeDesk`; desktop integration and persistence/single-instance tests passed. The old distribution folder and temporary Chrome profiles were removed.

### Motion pass

- Added a motion layer to `public/style.css`: staggered page/card reveals, ambient background drift, hero sheen, stat line/number motion, button shine, card hover lift + sheen, verified-avatar halo, running-card scan/pulse, settings/field reveal, auth-status/error motion, new-log slide, countdown pulse, dialog backdrop, and card exit animation.
- Kept all animation CSS-only; no new dependencies. Removed inline-style writes so the existing `style-src 'self'` CSP remains intact.
- Added `prefers-reduced-motion` delay reset and disabled hover transforms, decorative glows, and spotlight effects for reduced motion, touch, and forced-colors.
- Updated `public/app.js` only for state-triggered classes/numbers, animated removal, and countdown `soon` state; token storage and server calls unchanged.
- Verified in headless Chromium at 1440 and 700 px: no console/CSP errors, no horizontal overflow, settings/auth/running/log/countdown/removal states animate, and reduced-motion renders immediately. Node regression suite: 21/21 passed.
- The motion assets were first applied to the old desktop copy; the final per-user install below contains the rebuilt assets.

### Per-user bootstrapper install

- Added `installer/Bootstrapper.cs`, a WinForms bootstrapper compiled as one `TradeDeskSetup.exe` with an embedded ZIP payload. It installs to `%LOCALAPPDATA%\TradeDesk`, preserves existing `WebView2` profiles, and creates `TradeDesk.lnk` on the current user's desktop. No admin rights are requested.
- Added `scripts/build-bootstrapper.mjs`. It uses the .NET Framework 4.8 `csc.exe` and PowerShell's `ZipFile` to create the single-file setup, so no installer framework or extra runtime is required at build time. `/silent` and `/launch` switches are supported.
- Verified a silent install: exit log success, 751 files in the target including preserved WebView2 profiles, installed public assets match the build hashes, and the desktop shortcut points to `C:\Users\sasha\AppData\Local\TradeDesk\TradeDesk.exe`.
- Setup artifact: `dist\TradeDeskSetup.exe`, 96.63 MB, SHA-256 `f98fa197af964a61e2621b8efa8d3daf2b11e14a1d4e3f41813111c2e8b0a8d3`. The setup is unsigned; SmartScreen may warn.
- Moved the old `C:\Users\sasha\Desktop\TradeDesk` copy to `D:\TradeDesk-build\previous-desktop\TradeDesk` so the user profile copy is the active install. A previously launched build from `D:\TradeDesk-build\TradeDesk` was still running during installation; it must be closed before the new desktop shortcut will start the installed copy because the app is single-instance.
