# Changelog

All notable changes to Nexus are documented here. The project ships two
installers per release, both attached to the matching GitHub release:

- **Nexus-Setup-&lt;version&gt;.exe** — the main app + local server (launcher).
- **Nexus-Cross-Setup-&lt;version&gt;.exe** — the Stream Deck satellite
  ("Nexus Cross"), run on another LAN machine that has a deck plugged in.

Versioning is shared: the `version` in `launcher/package.json` drives the
release tag; `package.json` (web app) and `nexus-cross/package.json` are
kept in lockstep.

## 0.1.8

### Multi-instance connections
- Add **multiple connections of the same kind** (e.g. several vMix, OBS,
  Ableton, X32, grandMA). New connections auto-number their label
  (`vMix`, `vMix 2`, …) and stay renamable.
- **Default connection per kind** (star on a connection card). Un-pinned
  Stream Deck actions resolve to it, and the single-instance pages
  (live / playlist / titles / colorimetry) drive the default vMix —
  changing the default mirrors its host/port into those pages.
- A kind's sidebar pages now appear **only when a connection of that
  kind exists**. You can delete every connection and end up with none;
  the Deck page always stays so you can prepare shortcuts in advance.

### Stream Deck editor
- **Per-action connection targeting** — a single key can drive several
  actions across different devices/instances (e.g. vMix #1 cut + OBS
  scene + Ableton clip), each on its own connection.
- **Multi-action buttons** — drop another preset on an occupied key to
  append its actions; reorder (↑/↓) and remove actions in the inspector.
- **Copy / paste keys** (Ctrl/Cmd+C/V or inspector buttons) to duplicate
  shortcuts.
- **Pages** rail: click to switch, double-click to rename, add/delete,
  with pairing + key-count indicators.
- **Import / export** pages (single or all) as JSON, with a connection
  **remap** step on import — keep matching connections, or reassign each
  to a local one (including actions that ran on a kind's default).
- **Load to deck** modal: pick a physical deck + a page, pair and push in
  one step.

### Nexus Cross (Stream Deck satellite) — new
- Run a Stream Deck on a different machine than the one hosting Nexus.
  The satellite announces its decks, applies renders pushed over SSE, and
  forwards key presses back; bindings + feedbacks work unchanged.
- Shipped as a tray app with an NSIS installer, matching the main app
  (status window, server-URL setting, GitHub-release updater).
- Server re-renders the paired page whenever a satellite (re)connects, so
  a restart never leaves the deck blank; render payloads are slimmed to
  the visual fields only.

### Network page
- The subnet scanner is now a **general network scanner**
  (`network-scanner.bat`), not vMix-only: one unified "Discovered
  devices" list classifying every host (vMix/OBS via handshake;
  X32/grandMA/camera/PC via open ports), AV gear sorted first.

### Tooling &amp; internals
- **Test suite** — Vitest covering hardware-independent logic (OSC
  codec round-trips, server-URL normalisation, the release/semver
  helpers). `npm test`.
- **CI quality gate** (`.github/workflows/checks.yml`) reused by every
  pull request and by the release build: version lockstep, lint, type
  checks across all three packages, and the unit suite. No installer is
  built on a red tree.
- **Version lockstep tooling** — `npm run version:sync` /
  `version:check` keep the three `package.json` *and* their
  `package-lock.json` versions aligned (a recurring `npm ci` foot-gun
  at release time).
- **Updater dedup** — shared, unit-tested release-parsing core between
  the launcher and satellite.
- **Large-page decomposition** — the OBS and Stream Deck pages were
  split into focused colocated components (behaviour unchanged).
- Satellite HID failures are now logged; the launcher validates the
  configured port before restarting the server; the satellite respects
  an explicit `:443`/`:80` proxy port instead of forcing `:9088`.

## 0.1.7
- Launcher: separate path resolution from the route handlers (cleaner
  packaged-vs-dev server discovery).

## 0.1.6
- Drop the `process.cwd()` ffmpeg fallback to silence a Turbopack NFT
  trace warning during the build.

## 0.1.5
- Launcher: persistent version footer in the window.

## 0.1.4
- Ship `icon.ico` as an `extraResource` so the tray and window icons
  render at runtime in the packaged app.

## 0.1.3
- Fix the update banner staying visible when no update is available
  (CSS `[hidden]` override).

## 0.1.2
- Update banner always opens the GitHub releases page.

## 0.1.1
- App icon, author metadata, npm audit fixes.

## 0.1.0
- Initial release: vMix companion web app (live, playlist, titles,
  colorimetry, replay, timers, audio), LAN-first Electron launcher with
  a bundled standalone server, web-asset / overlay designer, the Ableton
  OSC bridge, and GitHub-release auto-update.
