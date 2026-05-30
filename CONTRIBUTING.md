# Contributing to Nexus

Nexus is source-available (see [`LICENSE`](./LICENSE)). These notes
describe how the repo is built, tested, versioned, and released so
changes stay consistent.

## Repository layout

This is a small multi-package repo (no workspaces — each app installs and
builds independently):

| Path | What it is |
|------|------------|
| `/` (root) | The Next.js web app + LAN server (the "app"). |
| `launcher/` | Electron tray app that runs the standalone server. |
| `nexus-cross/` | Electron Stream Deck satellite for another LAN machine. |

One release ships **two installers** — `Nexus-Setup-*.exe` (launcher) and
`Nexus-Cross-Setup-*.exe` (satellite) — both attached to the same GitHub
release.

## Prerequisites

- Node.js 22+
- npm
- Windows for building the installers (the packaging config is Windows-
  specific today; the app/launcher code is cross-platform).

```bash
npm install            # root (web app)
cd launcher && npm install
cd ../nexus-cross && npm install
```

## Dev loops

- **Web app only:** `npm run dev` (Next.js on http://localhost:3000).
- **Full launcher (spawns the server):** `npm run dev:launcher`.
- **Satellite:** `cd nexus-cross && npm run dev` (or `dev-cross.cmd`).

## Quality gate

Everything below runs in CI (`.github/workflows/checks.yml`) on every PR
and before any release build. Run it locally before pushing:

```bash
npm run version:check        # 3 package.json + lockfiles in lockstep
npm run lint                 # eslint (web app + nexus-cross sources)
npx tsc --noEmit             # type-check the web app
( cd launcher && npx tsc --noEmit )
( cd nexus-cross && npx tsc --noEmit )
npm test                     # Vitest (hardware-independent logic)
```

Tests live in `/tests` and run in the Node environment — they cover pure
logic (OSC codec, URL/version helpers, validators), not React UI. Add a
test alongside any new pure helper.

### Code style

- TypeScript `strict` everywhere.
- ESLint (Next.js core-web-vitals + typescript). Prefix intentionally
  unused params/locals with `_` instead of disabling the rule.
- Match the surrounding code's idiom and comment density.

### Adding a device kind

Device support is a registry plugin: implement the `DeviceKind` contract
in `src/lib/kinds/<kind>.ts` and register it in `src/lib/core/boot.ts`.
Brokers are per-instance (one transport per connection) and start lazily
on first subscriber. See an existing kind (e.g. `x32.ts`) as a template.

## Versioning & releasing

The version is shared across all three packages; `launcher/package.json`
is the source of truth (it drives the release tag).

1. Bump the version and propagate it everywhere (package.json **and**
   lockfiles):
   ```bash
   npm run version:sync 0.2.0      # or edit launcher/package.json, then `npm run version:sync`
   ```
2. Update `CHANGELOG.md`.
3. Commit and push to `master`.

`release.yml` then runs the quality gate, builds both installers on a
Windows runner, and publishes a GitHub release tagged `v<version>` with
both `.exe` files attached — but only if the tag doesn't already exist.
Each app's in-app updater watches that release for its own installer
asset.
