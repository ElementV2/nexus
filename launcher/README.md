# Nexus Launcher

Electron app that runs the Nexus Next.js server locally and exposes it
on the LAN. Designed to feel like Companion: a small status window with
the LAN URLs, system tray icon, settings.

Default port: **9088** (configurable in the launcher window).

## One-time setup

```bash
cd launcher
npm install
```

## Development (hot reload, no rebuild)

From the **repo root**:

```bash
npm run dev:launcher
```

The launcher detects the absence of `../.next/standalone/` and spawns
`next dev` in dev mode instead — hot reload for the web UI, no rebuild
needed when you edit the Next.js code. The launcher itself still needs a
re-launch when its own code changes.

Or, for a no-Electron dev loop, just run `npm run dev` at the root and
open `http://localhost:3000` directly.

Settings (port, etc.) are stored at:

- Windows: `%APPDATA%\Nexus\launcher.json`
- macOS:   `~/Library/Application Support/Nexus/launcher.json`
- Linux:   `$XDG_CONFIG_HOME/nexus/launcher.json`

App data (overlays, preferences) lives next to it as JSON files.

## Building a portable .exe

```bash
npm run release:win
```

This script:

1. Runs `next build` at the repo root (Next.js standalone output)
2. Compiles the launcher TypeScript
3. Runs `electron-builder --win --x64` → produces `dist/Nexus-Setup-${version}.exe`
4. Copies the binary into `../public/downloads/Nexus-Setup.exe` so the web app
   can serve it via `/downloads/Nexus-Setup.exe`

The final binary bundles:

- Electron runtime (~100 MB)
- Next.js standalone build + node_modules (~30 MB)
- `ffmpeg-static` with libsrt (~80 MB)
- launcher code

…around 200 MB total. Distribute the single `.exe`, the user double-clicks
and gets a Companion-style launcher.
