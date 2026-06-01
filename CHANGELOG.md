# Changelog

All notable changes to Nexus are documented here. The project ships two
installers per release, both attached to the matching GitHub release:

- **Nexus-Setup-&lt;version&gt;.exe** — the main app + local server (launcher).
- **Nexus-Cross-Setup-&lt;version&gt;.exe** — the Stream Deck satellite
  ("Nexus Cross"), run on another LAN machine that has a deck plugged in.

Versioning: the web app (`package.json`) and the launcher
(`launcher/package.json`) ship in the same installer and share one
**main-app** version, which drives the release tag. **`nexus-cross` is
versioned independently** — bump it only when the satellite changes, so a
main-app-only release doesn't make Cross users re-download. Each in-app
updater compares against the version embedded in its own installer asset
name (`Nexus-Setup-X.Y.Z.exe` / `Nexus-Cross-Setup-X.Y.Z.exe`), not the
shared release tag.

## 0.1.15 — main app · 0.1.5 — Nexus Cross

### Stream Deck — works headless, restores itself
- **The deck now works without opening the web UI.** On server start the
  device runtime boots itself (a startup self-request triggers the broker
  reconcile + press dispatcher + feedback coordinator), so a plugged-in
  deck **responds to presses and shows live feedback** with no browser
  open.
- **Last page restored on launch.** When the server (re)starts, each deck
  is repainted with the layout paired to its serial — retried until the
  deck is actually connected, so a deck that wasn't ready the instant the
  server came up still gets its page.
- **Decks reset to the Elgato standby logo on shutdown** instead of
  leaving stale, dead buttons lit. Local decks reset on a clean quit (the
  launcher releases them before killing the server); satellite decks reset
  on quit **and** when they lose the server (so a force-killed server still
  leaves them clean).
- **A failed press flashes the key red** (with a `!` badge) instead of
  silently doing nothing — on a control surface you now *see* when an
  action didn't take (device down / timed out). Failed steps are also
  logged server-side.
- **"Load to deck" always repaints every key** (fresh handle + cache
  invalidation), fixing the case where a loaded layout only showed the
  keys with feedback / the ones you pressed after another app (e.g. Elgato
  Stream Deck) had touched the device.

### Multi-action reliability
- **A slow or dead device can no longer freeze a multi-action button.**
  Each step is capped (1.5 s) instead of blocking the whole sequence for
  the broker's full transport timeout.

### Nexus Cross (satellite)
- **The deck stays listed across a reconnect.** Clicking Connect used to
  close + reopen the HID, so the deck vanished from the window for a few
  seconds — the deck handle is now independent of the server link.
- **Disconnect keeps the deck visible** (and resets it to the logo) instead
  of dropping it from the list.
- **Quit confirmation dialog** (mirrors the launcher) — quitting releases
  the local decks, so it's now a deliberate choice.
- **Clearer "deck in use by another app" message** when a deck is detected
  but can't be opened (another program holds it), instead of a misleading
  "no deck detected".

### Stability & correctness hardening
- **A single invalid connection can no longer brick every device.** One
  bad config used to abort the whole reconcile, leaving the app with no
  brokers and no working keys; bad entries are now skipped and logged.
- **OBS stops reconnecting in a tight loop on a permanent auth failure**
  (wrong password / RPC mismatch).
- Smaller fixes: a re-identify (audio-meter toggle) no longer triggers a
  full OBS snapshot rebuild; deleted OBS scenes no longer linger in the
  cached snapshot; a departed satellite's key-face cache is purged; the
  vMix state message is no longer mutated after it's been handed out.

### Internals
- **Feedback is now data-driven per kind.** Each device declares its
  Stream Deck feedback rules in a co-located `kinds/<kind>-feedback.ts`
  module that self-registers, replacing the central hardcoded switch
  (behaviour unchanged).
- **vMix SSE no longer ships the full raw XML** in every state frame — its
  only consumer (the removed debug page) is gone, cutting the dominant
  serialization cost on the vMix path.
- **Action lookup is indexed** (was a linear scan over ~450 vMix actions
  per press).

### Removed
- The **Dashboard hub** and the **raw-XML debug** pages were removed; the
  deck is now the default landing page.

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

### Stream Deck feedback — vMix
- Keys now reflect live state: **tally** (cut/transition + preview keys go
  red on PGM, green on PVW, PGM wins), **overlay live** (an OverlayInput key
  turns green when its overlay channel is showing its input; Off/Out keys
  light up whenever the channel is up), **audio bus on/off** (green when the
  bus/master is on, dim when muted), **per-input mute** (red MUTE), and
  stream/record/FTB. The vMix broker now publishes overlay, bus and
  per-input-mute variables; feedback is keyed on the generated action ids.

### vMix — full shortcut coverage
- The preset browser now lists **every vMix Function**, generated from the
  scraped reference (`src/lib/vmix/shortcuts.ts`) plus the named
  transitions the reference omits (Cut, Fade, Wipe, Slide, Fly, Zoom,
  Merge, …). The old hand-curated tiles were **removed** to avoid
  duplicates — their hand-tuned colours were carried onto the matching
  generated tiles (every tile is coloured; PGM/cut red, preview green,
  fade orange, …).
- Numbered/lettered **families are condensed into one parameterized
  preset** instead of dozens of near-duplicates: e.g. `OverlayInput{ch}`
  is a single tile with an *Overlay #* picker + Input, `SetBus{bus}Volume`
  a single tile with a *Bus* dropdown. The dispatcher now also forwards
  the `Channel` param.

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
- **Undo / redo** in the editor — `Ctrl/Cmd+Z` undoes, `Ctrl/Cmd+Y`
  (or `Ctrl/Cmd+Shift+Z`) redoes. History is per-page and coalesces a
  burst of rapid edits into one step.
- **Clearing a key is now the Delete key** (select a key, press Delete),
  not right-click — a stray right-click no longer wipes a shortcut. The
  inspector's Clear button still clears too.
- **One page → many decks.** A layout can now be loaded onto several
  decks at once, local or across satellites (e.g. the same page on 15
  satellite decks). Each deck still shows exactly one page; loading a page
  onto a deck moves that deck off whatever page it showed before. The
  pages rail shows a `×N` badge and an online count.

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
- **Updater dedup** — a unit-tested release-parsing core kept byte-identical
  between the launcher and satellite (each Electron app is a standalone TS
  project, so the file is duplicated-but-identical rather than imported).
- **Large-page decomposition** — the OBS and Stream Deck pages were
  split into focused colocated components (behaviour unchanged).
- Satellite HID failures are now logged; the launcher validates the
  configured port before restarting the server; the satellite respects
  an explicit `:443`/`:80` proxy port instead of forcing `:9088`.

### Fixes
- **Tally feedback: PROGRAM now wins over PREVIEW.** An input that's live
  (on PGM) stays red on a preview button even when it's also queued on
  PVW — live is the priority signal. Applies to vMix cut/preview and OBS
  program/preview-scene buttons.
- **Removed the redundant white feedback badge** (the small square in a
  key's top-right). It only ever duplicated the background-colour tally;
  meaningful coloured badges (studio mode, etc.) stay.
- **Stream Deck: a deck re-plugged after being unplugged (or moved to a
  satellite and back) renders again.** The driver now closes the HID
  handle when a deck disappears, so re-plugging on the same USB port
  opens a fresh handle instead of reusing a dead one (renders had
  silently no-op'd). `listDevices` also de-dupes by serial, preferring a
  locally-plugged deck over a stale satellite still advertising it.
- **Stream Deck: loading a page onto a deck now unpairs the previous
  page from that device.** Two pages could both claim one deck's serial,
  so the deck showed the new page's keys but fired the OLD page's
  shortcuts. A serial now maps to exactly one page.
- **Independent satellite versioning** — the updater reads each app's
  version from its own installer asset name, so a main-app release no
  longer shows a phantom "update available" on Nexus Cross (and the
  Download button only appears when a matching installer actually
  exists).
- **Nexus Cross settings**: separate IP and Port fields (no more typing
  `http://…`); the "Label" field is now "Name (on network)".

### Performance &amp; stability (broadcast hardening)
- **Stream Deck store is cached** (mtime-gated) — the feedback coordinator
  no longer does a synchronous disk read + JSON parse on every variable
  tick, freeing the event loop on the tally hot path.
- **OBS socket identity guard** — editing an OBS connection's host/port no
  longer lets the old socket's late `close` orphan the new one (which made
  commands silently fail and spawned a phantom reconnect).
- **Dead satellites are reaped** — a satellite that drops off the LAN is
  now removed after ~3 missed heartbeats instead of lingering forever and
  buffering renders nobody drains.
- **OBS thumbnails share one rate-capped scheduler** — a big scene grid no
  longer fires 15–30 screenshot requests/sec at OBS's encoder; requests
  are sequential, round-robin, and capped.
- **SSE reconnects use jittered backoff** and the variables stream now
  tears down on a hidden tab — no more lockstep reconnect storm after a
  server blip. Satellite SSE has bounded backpressure.
- **HID hardening** — a dead deck handle is evicted on write failure and
  the face cache is dropped on close, so a re-plugged deck redraws; USB
  hotplug listeners are removed on teardown.

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
