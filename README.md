# Nexus

> Browser-based, LAN-first remote controller for [vMix](https://www.vmix.com/).

Nexus is a Next.js + Electron application that exposes a full operator
UI for vMix on any device on the local network. Run the launcher on
the same PC as vMix, open the printed LAN URL on a phone, tablet, or
second machine, and you have a clean touch-friendly control surface
for live production — no extra hardware required.

The launcher itself is a small Electron window that boots a local web
server. The web app is the actual UI; the launcher just gives you the
LAN URL, a port picker, and a logs viewer.

---

## Highlights

- **Multi-page operator UI** — Live (PGM/PVW routing + transition
  picker), Replay (transport + channels + events + marks), Audio,
  Playlist, Titles, Web Assets, Colorimetry, Network, Ableton, Timers,
  Live preview, Dashboard.
- **LAN-first** — bind the server to a specific interface or all
  interfaces; share the URL with co-operators on the same network.
- **Touch-friendly** — designed for tablets sitting on FOH consoles;
  big targets, drag-selection guard, no accidental zooming.
- **Ableton bridge** (optional) — clip launch, scene control, and
  transport over OSC via [AbletonOSC](https://github.com/ideoforms/AbletonOSC).
- **Auto-update check** — the launcher polls GitHub on startup and
  shows a banner when a newer release is available.
- **Single executable** — `Nexus-Setup.exe` bundles Electron, the
  Next.js standalone build, and `ffmpeg-static` with libsrt for the
  built-in stream player. Around 200 MB on disk.

---

## Requirements

- **vMix 27+** with the Web Controller enabled (HTTP API on port 8088
  by default). Nexus reads vMix state by polling `/api` over HTTP and
  sends commands back the same way.
- **Windows 10 / 11** for the prebuilt launcher. The web UI itself
  works on any modern browser (mobile Safari, Chrome, Edge, Firefox).
- **Optional: AbletonOSC** installed in Ableton Live's MIDI Remote
  Scripts folder, if you want to use the Ableton page.

---

## Install (end user)

1. Grab the latest `Nexus-Setup-x.y.z.exe` from the
   [Releases page](https://github.com/ElementV2/nexus/releases/latest).
2. Run the installer. Windows SmartScreen may warn — the binary isn't
   code-signed yet (signing certs are expensive for a hobby project).
   Click **More info → Run anyway**.
3. Launch **Nexus** from the Start menu or desktop shortcut. The
   launcher window opens with the LAN URLs ready to share.
4. Click **LAUNCH GUI** to open the operator UI in your default
   browser, or copy one of the printed `http://192.168.x.x:9088`
   URLs into a tablet's browser on the same Wi-Fi.

The launcher lives in the system tray when its window is hidden.
Quit it from the tray menu when you're done — the local web server
stops with it.

---

## Quickstart

1. Open vMix → **Settings → Web Controller → Enabled** (port 8088).
2. Start Nexus.
3. In the Nexus launcher window, leave the defaults (`All interfaces`,
   port `9088`) or pick a specific NIC if you have multiple.
4. Open the GUI. On the **Network** page, set the vMix host to
   `localhost` (or another machine's IP) and verify the
   "Connected" pill goes green.
5. Move to the **Live** page — you should see PGM / PVW and all your
   inputs.

For the Ableton page, install AbletonOSC, set the send/recv ports on
the Network page to match (defaults: send `11000`, recv `11001`), then
open Ableton.

---

## Development

```bash
git clone https://github.com/ElementV2/nexus.git
cd nexus
npm install
cd launcher && npm install && cd ..
```

### Web UI only (no Electron, no LAN)

```bash
npm run dev
```

Opens `http://localhost:3000`. Fastest feedback loop for component
work — hot reload, browser dev tools, no Electron in the loop.

### Full launcher + web UI (Electron + LAN)

```bash
npm run dev:launcher
```

The launcher spawns `next dev` automatically (hot reload still works)
and binds to the network. Iteration loop: edit React/CSS, save, the
browser at `http://localhost:9088` reloads. The launcher window itself
needs to be relaunched only when its own TypeScript changes.

Or, on Windows, double-click `dev-launcher.cmd` from File Explorer for
the same thing.

### Lint / typecheck

```bash
npm run lint                      # eslint on src/
npx tsc --noEmit                  # web app TypeScript
cd launcher && npm run typecheck  # launcher TypeScript
```

---

## Build

```bash
cd launcher
npm run release:win
```

Runs `next build` (standalone output) → compiles the launcher TS →
invokes `electron-builder` → copies the produced `Nexus-Setup-x.y.z.exe`
into `public/downloads/` so the web app can also serve it as a download.

Output: `launcher/dist/Nexus-Setup-<version>.exe`. The bundle includes
the Electron runtime (~100 MB), the Next.js standalone build (~30 MB),
`ffmpeg-static` with libsrt (~80 MB), and the launcher itself.

---

## Releases (CI)

Releases are auto-built and published by `.github/workflows/release.yml`.

**How to cut a release:**
1. Bump the `version` field in `launcher/package.json`.
2. Commit and push to `master`.
3. GitHub Actions builds the installer on a Windows runner and creates
   a GitHub Release tagged `v<version>` with the `.exe` attached.

If the tag for the current version already exists, the workflow runs
to completion but skips the build step — so day-to-day pushes don't
re-trigger releases. Only a version bump fires a new build.

The launcher itself polls `releases/latest` every 6 hours and shows an
amber "Update available" banner when a newer build is published. The
banner links straight to the new `.exe` for a manual upgrade
(installers replace the previous install in place).

---

## Architecture

```
.
├── src/                     # Next.js web app
│   ├── app/
│   │   ├── (app)/           # Operator pages
│   │   │   ├── live/        # PGM / PVW routing + transition picker
│   │   │   ├── replay/      # Replay transport, channels, events, marks
│   │   │   ├── audio/       # Bus matrix, master strip, meters
│   │   │   ├── playlist/    # Output buttons + transitions
│   │   │   ├── titles/      # Title input editor
│   │   │   ├── web-assets/  # In-browser title editor (text / images)
│   │   │   ├── colorimetry/ # Per-input color correction
│   │   │   ├── network/     # vMix + Ableton connection panels
│   │   │   ├── ableton/     # Clip launcher + transport (OSC)
│   │   │   ├── timers/      # Countdown / countup timers on overlays
│   │   │   ├── live-preview/# Compact MPEG-TS viewer
│   │   │   ├── dashboard/   # Multi-pane overview
│   │   │   └── debug-xml/   # Raw vMix XML inspector
│   │   ├── api/             # Next.js route handlers (vMix proxy, etc.)
│   │   └── layout.tsx
│   ├── components/          # Reusable UI (sw = Swiss design system)
│   ├── stores/              # Zustand stores (vmix, ableton, …)
│   ├── hooks/               # use-vmix-command, useOptimisticValue, …
│   ├── lib/
│   │   ├── vmix/            # Command builders + XML parser
│   │   ├── ableton/         # OSC broker + API
│   │   └── db/              # JSON data store (preferences, overlays)
│   └── styles/              # Tokens + components.css
│
├── launcher/                # Electron desktop wrapper
│   ├── src/
│   │   ├── main.ts          # Window, tray, IPC, lifecycle
│   │   ├── preload.ts       # Bridges IPC to the renderer
│   │   ├── server-manager.ts# Spawns the Next.js standalone / dev server
│   │   ├── prefs.ts         # Shared launcher.json + preferences.json
│   │   ├── updater.ts       # GitHub releases polling + version compare
│   │   └── renderer/        # Swiss-style status window
│   ├── scripts/             # Build glue (install binary, copy renderer)
│   └── resources/icon.ico
│
├── public/downloads/        # Where the built installer is copied
├── .github/workflows/       # CI: release.yml
└── README.md
```

### Data flow (web ↔ vMix)

1. The web app polls vMix's HTTP API (`http://<host>:8088/api`) every
   ~150 ms (configurable on the Network page).
2. XML response is parsed in `src/lib/vmix/` into a normalized store
   shape (Zustand).
3. UI subscribes via narrow selectors — pages re-render only when the
   slice they care about changes.
4. User actions call `useVmixCommand()` which builds the command URL
   (`/api?Function=…&Input=…`) and fires HTTP GET via a Next.js
   route handler proxy (so the browser doesn't need direct network
   access to vMix).

### Data flow (Ableton bridge)

1. AbletonOSC listens on UDP `11000` and sends back on `11001`.
2. The Next.js server holds a single OSC broker
   (`src/lib/ableton/osc-broker.ts`) that owns one socket pair
   regardless of how many browser tabs are open.
3. Browser tabs stream Ableton state via Server-Sent Events from the
   broker; commands go HTTP POST → broker → OSC out.

### State persistence

User-facing prefs (vMix host, Ableton host, MRU host list, polling
interval, transition durations, hidden tiles per host…) live in JSON
files under:

- Windows: `%APPDATA%\Nexus\`
- macOS:   `~/Library/Application Support/Nexus/`
- Linux:   `$XDG_CONFIG_HOME/nexus/`

The launcher and the Next.js server share the same directory via the
`NEXUS_DATA_DIR` env var, so prefs survive a restart and stay in sync
between the desktop shell and the in-browser UI.

---

## Tech stack

| Layer | Tech |
|---|---|
| Web framework | Next.js 16 (App Router, React 19, Turbopack) |
| State | Zustand |
| Styles | Tailwind v4 + custom design tokens (Swiss/Tactical Refined) |
| UI primitives | Radix UI, Lucide icons, custom `sw/` components |
| Video | `mpegts.js` (MPEG-TS player), `ffmpeg-static` (libsrt) |
| Desktop shell | Electron 32 + `electron-builder` (NSIS installer) |
| OSC bridge | Custom UDP broker, Server-Sent Events to the browser |
| Storage | JSON files (atomic write, quarantine on parse error) |
| Package manager | npm |

---

## Roadmap / known gaps

- No code-signing certificate yet → Windows SmartScreen warns on
  first install.
- macOS / Linux installers not built by CI (the launcher code is
  cross-platform; only `electron-builder` configuration is Windows-
  specific today).
- No auto-install of updates — the banner links to the installer
  download, you run it manually. Self-updating Electron apps need
  code-signing on Windows, hence the manual flow for now.

---

## License

Not yet licensed. All rights reserved by the author until a license
file is added. Open an issue if you want to use Nexus commercially or
contribute.
