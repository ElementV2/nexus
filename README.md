# Nexus

> Browser-based, LAN-first control surface for live production —
> [vMix](https://www.vmix.com/), OBS, Ableton Live, Behringer X32,
> grandMA2/3, and Stream Decks, from one operator UI.

Nexus is a Next.js + Electron application that exposes a full operator
UI for your production devices on any machine on the local network. Run
the launcher on a PC, open the printed LAN URL on a phone, tablet, or
second machine, and you have a clean touch-friendly control surface for
live production — plus a Stream Deck layout editor that drives local or
remote (satellite) decks. No extra hardware required.

The launcher itself is a small Electron window that boots a local web
server. The web app is the actual UI; the launcher just gives you the
LAN URL, a port picker, and a logs viewer.

---

## Highlights

- **Multi-page operator UI** — Live (PGM/PVW routing + transition
  picker), OBS (scenes/audio/media/filters), Stream Deck editor, Replay
  (transport + channels + events + marks), Audio, Playlist, Titles, Web
  Assets, Colorimetry, Network, Ableton, Timers, Live preview.
- **Multi-device, multi-instance** — several vMix / OBS / Ableton / X32 /
  grandMA connections at once, each on its own broker, with a default
  per kind.
- **Stream Deck surfaces** — a drag-and-drop layout editor; one page can
  drive many decks, local or on remote machines via the nexus-cross
  satellite; live tally/feedback on the keys. Decks work **headless** (no
  browser needed), **restore their last page on launch**, flash a key red
  when a press fails, and **reset to the standby logo on shutdown**.
- **LAN-first** — bind the server to a specific interface or all
  interfaces; share the URL with co-operators on the same network.
- **Touch-friendly** — designed for tablets sitting on FOH consoles;
  big targets, drag-selection guard, no accidental zooming.
- **Ableton bridge** (optional) — clip launch, scene control, and
  transport over OSC via [AbletonOSC](https://github.com/ideoforms/AbletonOSC).
- **Auto-update check** — the launcher polls GitHub on startup (then every
  6 h) and shows a banner when a newer release is available.
- **Single executable** — `Nexus-Setup.exe` bundles Electron, the
  Next.js standalone build, and `ffmpeg-static` with libsrt for the
  built-in stream player. Around 200 MB on disk.

---

## Supported devices

Add any number of each in **Network › Connections** — none is mandatory.

| Device | Transport | Default port | Prerequisite |
|---|---|---|---|
| **vMix** | HTTP XML API (poll + commands) | 8088 | vMix 27+, Web Controller enabled |
| **OBS Studio** | obs-websocket v5 (push) | 4455 | obs-websocket (built into OBS 28+), password optional |
| **Ableton Live** | OSC — AbletonOSC | 11000 send / 11001 recv | AbletonOSC in the MIDI Remote Scripts folder |
| **Behringer X32 / M32** | OSC over UDP | 10023 | — (always listening) |
| **grandMA3** | OSC over UDP (command line + executors) | 9000 | OSC input enabled on the console |
| **grandMA 2** | Telnet command line | 30000 | Telnet enabled; console login |
| **Elgato Stream Deck** | USB HID (local) or LAN satellite | — | optional HID deps locally, or run nexus-cross on the deck's machine |

Each connection drives the matching operator page(s): vMix → Live / Audio /
Replay / Playlist / Titles / Colorimetry; OBS → OBS; Ableton → Ableton; the
mixers/consoles are controlled from the **Stream Deck editor** (actions,
presets, feedback). Pages appear only when a connection of that kind exists.

## Requirements

- **Windows 10 / 11** for the prebuilt launcher. The web UI runs on any
  modern browser (mobile Safari, Chrome, Edge, Firefox) — phone, tablet,
  or a second machine on the same network.
- **At least one supported device** reachable on the LAN (table above).

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

1. Start Nexus. In the launcher window, leave the defaults
   (`All interfaces`, port `9088`) or pick a specific NIC, then **LAUNCH
   GUI**.
2. Go to **Network › Connections → Add** and pick a device kind. Fill in
   its host/port (see [Supported devices](#supported-devices)) and **Test**
   until the status pill goes green.
3. Add as many devices as you need — each one lights up its own pages.

Example (vMix): enable **Settings → Web Controller** in vMix (port 8088),
add a vMix connection pointing at `localhost`, then open **Live** for
PGM / PVW + inputs. For Ableton, install AbletonOSC first (send `11000`,
recv `11001`). For Stream Decks, build a page in the **Deck** editor and
*Load to deck*.

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
├── src/                     # Next.js web app + LAN server
│   ├── app/
│   │   ├── (app)/           # Operator pages
│   │   │   ├── live/        # PGM / PVW routing + transition picker (vMix)
│   │   │   ├── obs/          # OBS scenes, audio, media, filters, stats
│   │   │   ├── streamdeck/   # Stream Deck layout editor (drag presets → keys)
│   │   │   ├── replay/       # Replay transport, channels, events, marks
│   │   │   ├── audio/        # Bus matrix, master strip, meters
│   │   │   ├── playlist/     # List / output buttons + transitions
│   │   │   ├── titles/       # Title input editor
│   │   │   ├── web-assets/   # In-browser title editor (text / images)
│   │   │   ├── colorimetry/  # Per-input color correction
│   │   │   ├── network/      # Connections panel + LAN device scanner
│   │   │   ├── ableton/      # Clip launcher + transport (OSC)
│   │   │   ├── timers/       # Countdown / countup timers on overlays
│   │   │   └── live-preview/ # Compact MPEG-TS viewer
│   │   ├── api/             # Route handlers:
│   │   │                    #   connections/:id (command + SSE events),
│   │   │                    #   streamdeck (devices, push, satellite, events),
│   │   │                    #   actions, bindings, presets, variables,
│   │   │                    #   overlays, web-assets, network, stream
│   │   └── layout.tsx
│   ├── components/          # Reusable UI (sw = Swiss design system)
│   ├── stores/              # Zustand stores (vmix, obs, ableton, overlay…)
│   ├── hooks/               # use-connections, use-variables, use-sse, …
│   ├── lib/
│   │   ├── core/            # Device-kind registry, per-instance broker
│   │   │                    #   adapter, connection manager, variable bus
│   │   ├── kinds/           # One file per device kind (vmix, obs, ableton,
│   │   │                    #   x32, grandma2/3) + its <kind>-feedback.ts;
│   │   │                    #   registered into core
│   │   ├── vmix/ obs/ ableton/ x32/ grandma3/ grandma2/ osc/  # brokers
│   │   │                    #   (HTTP poll / WebSocket / OSC-UDP / Telnet)
│   │   ├── streamdeck/      # HID driver, feedback coordinator, press
│   │   │                    #   dispatcher, satellite registry
│   │   └── db/              # JSON data store (preferences, layouts, overlays)
│   └── styles/              # Tokens + components.css
│
├── launcher/                # Electron desktop wrapper — main app installer
│   └── src/                 # main.ts, preload.ts, server-manager.ts,
│                            #   update-core.ts, updater.ts, renderer/
├── nexus-cross/             # Electron Stream Deck satellite — 2nd installer
│   └── src/                 # agent.ts, hid.ts, key-image.ts,
│                            #   server-client.ts, update-core.ts, renderer/
├── tests/                   # Vitest (OSC codec, URL + version helpers, …)
├── scripts/                 # sync-versions.mjs, copy-renderer.mjs (shared)
├── public/downloads/        # Where the built installers are copied
├── .github/workflows/       # CI: checks.yml (gate) · ci.yml (PR) · release.yml
└── README.md
```

### Architecture: device kinds + per-instance brokers

Every device type (vMix, OBS, Ableton, X32, grandMA2/3) is a **kind
plugin**: `src/lib/kinds/<kind>.ts` implements the `DeviceKind` contract
(config validation, actions, variables, broker factory) and registers
itself into `src/lib/core`. Each saved **connection** gets its own
**broker instance** (one transport — HTTP poll / WebSocket / UDP socket —
per connection), so several vMix machines or OBS instances run side by
side. Brokers publish state onto a shared **variable bus**; the UI and the
Stream Deck feedback layer both read from it.

### Data flow (UI ↔ a device)

1. A broker maintains the live link to its device — vMix HTTP polling
   (~150 ms, configurable), an OBS WebSocket, an Ableton/X32/grandMA3
   OSC-over-UDP socket, or a grandMA 2 Telnet line — and normalizes state
   into a Zustand store + the variable bus.
2. The browser streams that state over **Server-Sent Events** from
   `/api/connections/:id/events` (one EventSource per stream, shared
   across consumers, paused on a hidden tab).
3. UI subscribes via narrow selectors — pages re-render only when the
   slice they care about changes.
4. Actions `POST /api/connections/:id/command`; the server routes to the
   matching broker, which builds the device command (vMix URL, OBS
   request, OSC message) — the browser never talks to devices directly.

### Data flow (Stream Deck)

1. Layouts persist in `streamdeck.json`; each can be paired to several
   physical decks (`deviceSerials`), local or via a nexus-cross satellite.
2. A single server-side **feedback coordinator** watches the variable bus
   and re-renders changed keys (per-key debounce + change-detection); a
   single **press dispatcher** turns one physical press into one preset
   run regardless of how many browsers are open.
3. Remote decks bridge through a **satellite**: it announces its decks,
   receives slim render payloads over SSE, and forwards presses back.

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

## Troubleshooting

- **Windows SmartScreen warns on first install.** The installer isn't
  code-signed yet → click *More info → Run anyway*. (Tracked under
  Roadmap.)
- **`npm ci` fails with a version mismatch.** The three `package.json`
  and their lockfiles drifted. Run `npm run version:sync`, commit, retry.
  CI runs `npm run version:check` and fails fast on drift.
- **A device's sidebar pages don't show up.** Pages appear only when a
  connection of that kind exists — add one in *Network › Connections*.
  The Deck page always stays.
- **OBS won't connect.** Enable *Tools → WebSocket Server Settings* in
  OBS, then check host / port / password in *Network › Connections*.
- **Nexus Cross can't reach the server.** Type just the host/IP (the app
  adds `http://` and `:9088`); for a reverse proxy include the explicit
  port. Check the LAN firewall allows the Nexus port.
- **Nexus Cross doesn't see a Stream Deck.** Another app (e.g. Elgato's
  software) may already own the device — close it. The status window
  reports a *blocked* count when a deck is enumerated but can't be opened.

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

Nexus is **source-available, not open-source** — see [`LICENSE`](./LICENSE).
The code is published for reference; all rights are reserved by the
author. Contact death0factory@gmail.com to request a license to use it
or to discuss other terms.
