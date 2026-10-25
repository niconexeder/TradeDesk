# TradeDesk Bootstrapper, Payload Updates, and Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-file setup installer with a small bootstrapper that downloads the application payload from GitHub Releases, updates it in place, preserves data and WebView2 settings, supports uninstallation, and finishes encrypted token persistence and the in-app icon.

**Architecture:** A small C# WinForms bootstrapper at `%LOCALAPPDATA%\TradeDesk\TradeDeskBootstrap.exe` reads `latest.json` from the latest public GitHub release, downloads `TradeDesk-win-x64.zip`, verifies its SHA-256, extracts it into a staging folder, and atomically swaps it into `app\`. The shortcut points at the bootstrapper, not the app. User data lives outside `app\`; the app remains a .NET 8/WebView2 host with the Node backend. The public GitHub repository contains only releases and release metadata, not source.

**Tech Stack:** C# / .NET Framework 4.8 WinForms, .NET 8 WinForms app, Node.js 26, Windows DPAPI, GitHub Releases, PowerShell, `csc.exe`.

**Spec:** Approved chat design on 2026-10-26. The release contains `TradeDeskBootstrap.exe`, `TradeDesk-win-x64.zip`, and `latest.json`; the bootstrapper is the installer, updater, launcher, and uninstaller.

## Global Constraints

- Windows 10/11 x64; per-user installation in `%LOCALAPPDATA%\TradeDesk`; no administrator rights.
- Release assets are exactly `TradeDeskBootstrap.exe`, `TradeDesk-win-x64.zip`, and `latest.json`; do not upload individual DLLs.
- Public repository: `https://github.com/niconexeder/TradeDesk`; no source code is pushed without an explicit request.
- The shortcut `TradeDesk.lnk` targets `TradeDeskBootstrap.exe`.
- App files live in `%LOCALAPPDATA%\TradeDesk\app`; bootstrap in the root; data in `%LOCALAPPDATA%\TradeDesk\data`; WebView2 in `%LOCALAPPDATA%\TradeDesk\WebView2` and `WebView2-debug`.
- Updates must preserve `data` and `WebView2` directories and must be atomic with rollback.
- `latest.json` must contain a lowercase SHA-256 hash and byte size; the bootstrapper must reject a mismatch before extraction.
- Tokens are encrypted with Windows DPAPI `CurrentUser` in `data\tokens.dat`; never write plaintext tokens to disk, localStorage, logs, or release assets.
- The fixed backend port remains `47831`; single-instance behavior, no console, WebView2 profile, and backend shutdown on app close remain unchanged.
- All existing Node tests must keep passing.
- The bootstrapper is unsigned; document the SmartScreen warning and the residual update-trust limitation.

## Review Focus

- A corrupted or truncated ZIP, wrong SHA-256, or path-traversal entry must not replace a working installation.
- An offline first run must show a clear error; an offline update must launch the existing version.
- Updating while the app is running must not corrupt files; the old app must be launchable if the swap fails.
- Uninstall must remove the app, data, shortcut, and registry entry without deleting unrelated user files.
- Token persistence must not leak tokens through `/api/status`, logs, localStorage, or the token helper's stdout.
- The GitHub `latest/download/latest.json` URL must resolve, and the URL inside it must point at the matching release asset.

---

### Task 1: Finish token persistence and validation

**Files:**
- Modify: `server.mjs`
- Modify: `token-store.mjs` (already created; verify)
- Test: `tests/token-store.test.mjs`, `tests/tokens-api.test.mjs` (already created)

**Interfaces:**
- `new TokenVault({ helperPath, filePath, helperExists, runner })` exposes `available`, `load()`, `all()`, `set(id, token) => Promise<boolean>`, `remove(id) => Promise<boolean>`.
- `POST /api/token-save` accepts `{ id, token }` and returns `{ saved: boolean }`; `POST /api/token-remove` accepts `{ id }` and returns `{ saved: boolean }`; `GET /api/tokens` returns `{ tokens, persistence }`.
- Server validates the account ID with `/^[\w-]{16,80}$/` and the token with trimmed length 20–512 and no whitespace before calling the vault.

- [ ] **Step 1: Add server-side ID/token validation to the token-save and token-remove routes**

Return HTTP 400 for invalid values. Do not call the vault for invalid input.

- [ ] **Step 2: Run the token tests**

Run: `node --test tests/token-store.test.mjs tests/tokens-api.test.mjs`
Expected: 4 passing tests.

- [ ] **Step 3: Add the DPAPI helper and app wiring**

Create `desktop/TokenStore.cs` with commands `read <file>` and `write <file>` using `ProtectedData.Protect/Unprotect` with `DataProtectionScope.CurrentUser` and UTF-8 JSON. On write, read stdin to end and write atomically via a temporary file plus `File.Replace`. Compile it to `app\tokenstore.exe`.

In `desktop/MainForm.cs`, set:
- `TRADEDESK_TOKEN_HELPER=%LOCALAPPDATA%\TradeDesk\app\tokenstore.exe`
- `TRADEDESK_TOKEN_FILE=%LOCALAPPDATA%\TradeDesk\data\tokens.dat` (or `tokens-debug.dat` when `--debug`)

Create the data directory before starting Node.

- [ ] **Step 4: Test the helper manually**

Run the built helper directly with a temporary file; verify the file does not contain the token in plaintext, reading it back returns the same JSON, and the helper exits nonzero for malformed input.

### Task 2: Restore tokens in the card UI

**Files:**
- Modify: `public/app.js`
- Modify: `public/index.html`

**Interfaces:**
- `api('tokens')` returns the saved token map; `api('token-save', { id, token })` and `api('token-remove', { id })` return `{ saved }`.
- A card's `savedToken` is the token returned for its stable card ID.

- [ ] **Step 1: Add failing UI behavior**

Before starting the server, fetch `/api/tokens`; for each saved card ID, populate the password field with the saved token and trigger verification/autofill. If the endpoint reports `persistence: false`, leave fields unchanged.

- [ ] **Step 2: Persist after successful verification**

After `api('verify')` succeeds, call `api('token-save', { id, token })`. If it returns `saved: false`, keep the token only in memory and show a neutral note that persistence is unavailable.

- [ ] **Step 3: Delete on card removal or cleared token**

On `remove`, call `api('token-remove', { id })` before/with the remove action. When a token field becomes empty, call `token-remove` for that card; do not delete the token when verification merely fails.

- [ ] **Step 4: Update privacy copy**

Change the current “tokens are memory-only” copy in `public/index.html` and README to: tokens are stored encrypted for the current Windows user and can be cleared by removing the card; they are never stored in localStorage or logs.

- [ ] **Step 5: Verify**

Run `node --test tests/*.test.mjs` and manually verify: restart app -> token appears and verifies; remove card -> token file no longer contains the ID; clear field -> ID removed; duplicate-token block still works.

### Task 3: Generate the multi-size brand icon

**Files:**
- Modify: `desktop/TradeDesk.ico`
- Test: `tests/icon.test.mjs` (new)

**Interfaces:**
- The ICO contains 16, 24, 32, 48, 64, 128, and 256 px frames.
- Frame pixels use the `#6d7cff` → `#9b5cf6` gradient, white `T`, and `#8de7ff` arrow from `public/favicon.svg`.

- [ ] **Step 1: Write the failing icon test**

Read the ICO directory and assert the required sizes and that at least one frame has non-gray pixels matching the brand colors.

- [ ] **Step 2: Run the test to see it fail**

Run: `node --test tests/icon.test.mjs`
Expected: fail because the current icon lacks the required brand frames/colors.

- [ ] **Step 3: Generate the icon**

Rasterize `public/favicon.svg` (or draw the same rounded gradient square, T, and arrow with `System.Drawing`) at 1024 px, resize to each required size with high-quality interpolation, and pack the frames into `desktop/TradeDesk.ico`.

- [ ] **Step 4: Rebuild and verify**

Run: `node --test tests/icon.test.mjs`
Expected: pass. Visually verify the exe, window, taskbar, desktop shortcut, and bootstrapper all use the new mark.

### Task 4: Package the app payload and release manifest

**Files:**
- Modify: `scripts/build-desktop.mjs`
- Create: `scripts/build-release.mjs`
- Create: `scripts/build-bootstrapper.mjs` (replace old setup build)
- Modify: `README.txt` generation in `build-desktop.mjs`

**Interfaces:**
- `build-release.mjs` reads `package.json` version, builds `dist\TradeDesk` (or `TRADEDESK_OUTPUT`), compiles the DPAPI helper, creates `dist\TradeDesk-win-x64.zip` with the contents of the app root at the archive root, computes SHA-256/size, writes `dist\latest.json`, and compiles `dist\TradeDeskBootstrap.exe`.
- `latest.json` schema: `{ version, tag, asset, url, sha256, size, publishedAt, notes, minBootstrap }`.
- The ZIP must contain `TradeDesk.exe` at its root.

- [ ] **Step 1: Add a failing payload test**

Assert that building the release produces the ZIP with `TradeDesk.exe` at root, a valid `latest.json` with the right hash/size, and a bootstrapper under 2 MB.

- [ ] **Step 2: Implement ZIP creation**

Use `[System.IO.Compression.ZipFile]::CreateFromDirectory` or equivalent; do not include `data`, `WebView2`, tokens, or build caches. Fail if `TradeDesk.exe` is absent.

- [ ] **Step 3: Implement manifest generation**

Use lowercase SHA-256, actual byte size, version/tag from `package.json`, and URL:
`https://github.com/niconexeder/TradeDesk/releases/download/v<version>/TradeDesk-win-x64.zip`.
Write UTF-8 without BOM.

- [ ] **Step 4: Verify**

Run: `node scripts/build-release.mjs`
Expected: ZIP + valid manifest + bootstrapper. Extract the ZIP to a temp folder and confirm the app starts.

### Task 5: Implement the bootstrapper, updater, launcher, and uninstaller

**Files:**
- Rewrite: `installer/Bootstrapper.cs` as the launcher/updater (no embedded payload)
- Create: `tests/bootstrapper.test.mjs`
- Maybe split: `installer/Launcher.cs`, `installer/Program.cs` if the file grows beyond one responsibility.

**Interfaces:**
- `TradeDeskBootstrap.exe` with no args: ensure installed/latest, then launch the app; show progress only during install/update.
- `/silent`: no UI; return 0 on success, nonzero on failure.
- `/uninstall`: remove app/data/shortcut/registry and self; `/silent /uninstall` for unattended use.
- `/target <dir>`, `/manifest <url>`, `/no-shortcut`, `/no-launch`: test-only options enabled only when `TRADEDESK_BOOTSTRAP_TEST=1`.
- Production manifest URL: `https://github.com/niconexeder/TradeDesk/releases/latest/download/latest.json`.
- Installed version file: `%LOCALAPPDATA%\TradeDesk\version.txt` or `app\version.txt`; update if the manifest version is greater using `System.Version`.
- Atomic update: extract to `app.new`, rename `app` to `app.old`, rename `app.new` to `app`, remove `app.old`; on failure, restore `app.old`.
- Uninstall: remove shortcut only if it targets our bootstrapper; remove `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\TradeDesk`; remove the install root (including tokens) after confirmation; use a temporary `cmd.exe` cleanup for the running bootstrapper.
- Registry entry: `DisplayName`, `DisplayVersion`, `Publisher`, `InstallLocation`, `DisplayIcon`, `UninstallString`, `QuietUninstallString`, `NoModify=1`, `NoRepair=1`.
- Shortcut target: `%LOCALAPPDATA%\TradeDesk\TradeDeskBootstrap.exe`; icon from the bootstrapper.
- Download with TLS 1.2, a manifest timeout, and ZIP timeout; verify size and SHA-256 before extraction; reject ZIP entries that escape the staging root.
- If the app is already running, do not update; launch/activate the existing app or show a clear message.
- If offline and an app exists, launch it; if offline on first run, show a retryable error.

- [ ] **Step 1: Write the failing integration test**

Start a local HTTP server with a tiny `TradeDesk.exe`/`app` payload and a valid manifest. Run the bootstrapper with `TRADEDESK_BOOTSTRAP_TEST=1`, `/silent`, a temp target, `/manifest <local-url>`, `/no-shortcut`, `/no-launch`. Assert extraction, version file, and exit 0. Add cases for a wrong hash (no install, nonzero), update preserving `data`, and `/uninstall` removing the target. Run the test before implementing; expect failure (bootstrapper missing/not implemented).

- [ ] **Step 2: Implement manifest parsing and secure download**

Use `System.Web.Script.Serialization.JavaScriptSerializer` or `DataContractJsonSerializer`; set `ServicePointManager.SecurityProtocol = Tls12`; stream the ZIP to a temp file with progress; compute SHA-256 with `SHA256.Create()`; reject mismatch.

- [ ] **Step 3: Implement extraction and atomic swap**

Extract to `app.new`; validate `TradeDesk.exe`; swap with `app.old`; preserve `data`, `WebView2`, and `WebView2-debug`; clean staging on failure. Set `version.txt` only after a successful swap.

- [ ] **Step 4: Implement install/update/launch UI**

On first run, copy the bootstrapper to the root, create the shortcut and registry entry, download and install, then launch. On later runs, check the manifest; if offline/up-to-date, launch immediately. Use a dark small WinForms progress window; no console.

- [ ] **Step 5: Implement uninstall**

Handle `/uninstall`; confirm in UI; block if the app is running; remove shortcut/registry/root; schedule self-deletion via a temp `.cmd` with a retry loop, then exit.

- [ ] **Step 6: Run integration tests**

Run: `node --test tests/bootstrapper.test.mjs` and the manual install/update/uninstall smoke test. Expected: all pass; installed app launches from the shortcut.

### Task 6: Build, verify, and publish the GitHub release

**Files:**
- Modify: `README.md`
- Output: `dist\TradeDeskBootstrap.exe`, `dist\TradeDesk-win-x64.zip`, `dist\latest.json`

- [ ] **Step 1: Update documentation**

Document bootstrapper install/update/uninstall, payload URL, data locations, token encryption, SmartScreen, and the fact that source is not in the release repository.

- [ ] **Step 2: Run full verification**

Run: `node --test tests/*.test.mjs`; build; run the bootstrapper integration test; install into `%LOCALAPPDATA%\TradeDesk`; launch the app; verify icon, token persistence across restart, update from a previous version, uninstall, and clean reinstall.

- [ ] **Step 3: Authenticate to GitHub**

Use `gh auth login --web`; do not paste a token into chat. Verify the repo and no existing `v1.0.0` release.

- [ ] **Step 4: Create the release**

Create tag `v1.0.0`, title `TradeDesk 1.0.0`, upload the three assets, and publish. Use `gh release create v1.0.0 ...`.

- [ ] **Step 5: Verify the public URLs**

Fetch `https://github.com/niconexeder/TradeDesk/releases/latest/download/latest.json`; confirm the version, URL, size, and hash match the uploaded assets. Download the ZIP/bootstrapper anonymously and verify the SHA-256.

- [ ] **Step 6: Log out / revoke any exposed credentials**

Ensure no token remains in the repo, build output, logs, or shell history; remove temporary auth files.
