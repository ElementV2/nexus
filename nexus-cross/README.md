# Nexus Cross

LAN **satellite** for Nexus. Lets a Stream Deck plugged into machine
**A** drive a Nexus instance running on machine **B**, as long as both
are on the same network.

Ships as a small tray app (`Nexus-Cross-Setup-<version>.exe`) — the same
shape as the main Nexus launcher.

## How it works

```
   Stream Deck (USB)              Nexus server
        │                             ▲
        │ HID                         │
        ▼                             │
┌──────────────────┐   POST /press    │
│   Nexus Cross    │ ───────────────► │
│   (this agent)   │ ◄─────────────── │
└──────────────────┘   SSE renders    │
        ▲                             │
        │ POST /announce              │
        └─────────────────────────────┘
```

- Enumerates every local Stream Deck and POSTs its identity to
  `/api/streamdeck/satellite/announce`.
- Opens an SSE channel at `/api/streamdeck/satellite/events` and applies
  every `render` / `clear` / `brightness` message to the matching deck.
- Forwards key presses over `/api/streamdeck/satellite/press` — the
  server treats them like local key events, so bindings + feedbacks work
  unchanged.

## Use it (installer)

1. Install `Nexus-Cross-Setup-<version>.exe` on the PC the Stream Deck is
   plugged into. It launches to the tray.
2. Open the window, enter the Nexus server **IP** and **Port** (e.g.
   `192.168.1.10` / `9088` — no `http://`), give it a **Name**, and click
   **Connect**. **Open GUI** opens the server's web interface in your
   browser.
3. In Nexus, the deck shows up under **Deck → Load to deck** (and in
   pairing) tagged **(remote)**. Pair a page to it — renders push back to
   this agent automatically.

Settings live at `%APPDATA%\Nexus Cross\settings.json`.

## Develop / build from source

```bash
cd nexus-cross
npm install
npm run dev          # compile + launch Electron
npm run package:win  # → dist/Nexus-Cross-Setup-<version>.exe
```

Native deps (`@elgato-stream-deck/node`, `@napi-rs/canvas`, `usb`) are
rebuilt for the Electron runtime by `electron-builder`. On Windows you
need the standard node-gyp build chain (already present if you built the
main app).

## Notes

- SSE reconnects with exponential backoff (1 s → 30 s).
- The server buffers up to 500 render messages per satellite while the
  SSE is detached, and re-renders the paired page whenever the satellite
  (re)announces — so a brief drop or a restart doesn't leave the deck
  blank.
- Rescans USB every 30 s on top of hotplug events.

All binding / preset / feedback logic lives on the server. This agent
only owns HID + image composition.
