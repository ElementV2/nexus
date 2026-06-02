import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Dev-only request logging hygiene. Next dev prints a line per HTTP
  // request; the SSE `/events` streams stay open for minutes, so each logs
  // as e.g. `GET …/events 200 in 2.9min (application-code: 2.9min)` — which
  // reads like a 3-minute stall but is just the live-state connection being
  // held open (entirely normal). Together with the high-frequency
  // `/api/connections` poll, these drown the actual application logs in the
  // Server Activity panel. Filter them so what's left is signal — the
  // lifecycle / connection / press / crash lines from our own logger.
  // (Production `next start` / the packaged standalone server don't emit
  // these per-request lines at all.)
  logging: {
    incomingRequests: {
      ignore: [/\/api\/connections(\/[^/]+\/events)?(\?|$)/, /\/api\/stream(\?|$)/],
    },
  },
  // Native modules that must NOT be bundled by Turbopack — Node
  // resolves them at runtime from `node_modules` so their prebuilt
  // binaries are picked up correctly. `sharp` was the original entry;
  // the rest came in with the Stream Deck HID driver. These are
  // declared as `optionalDependencies` so Nexus still builds when
  // they're missing — the driver detects the load failure and
  // surfaces `state: "deps-missing"` to the UI.
  serverExternalPackages: [
    "sharp",
    "@elgato-stream-deck/node",
    "@napi-rs/canvas",
    "usb",
  ],
  // The app is local-LAN by design — anyone on the subnet must be
  // able to hit /_next/* in dev mode. Without this, Next 16+ logs a
  // cross-origin warning per request and will hard-block it in a
  // future major. Glob covers every RFC1918 private IPv4 range.
  allowedDevOrigins: [
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
  ],
  // Standalone output is what the Electron launcher packages and runs
  // via `node next-server/server.js`. Keeps the bundled web app self-contained.
  output: "standalone",
  // Force runtime-loaded native sidecar files into the standalone build.
  // NFT traces JS `require()`s but NOT files a native addon opens at runtime.
  //   • `node-hid` / `@julusian/jpeg-turbo` (transitive deps of
  //     `@elgato-stream-deck/node`, loaded via `node-gyp-build`): NFT traces
  //     their JS but NOT their `prebuilds/*.node`. Without this the PACKAGED
  //     server can't enumerate HID → `listStreamDecks()` throws → no decks
  //     (local AND, via the early-return, remote).
  //   • `@napi-rs/canvas`'s `icudtl.dat`: the skia `.node` binary IS traced
  //     (it's `require`d), but Skia opens the ~10 MB ICU data file by path at
  //     runtime, so NFT never copies it. Without it the packaged app crashes
  //     in a loop: `SkIcuLoader: datafile missing: …\icudtl.dat`. The driver
  //     loads canvas via dynamic import from the SAME streamdeck path, so the
  //     file rides in on this route. (Includes are copied ONCE into the shared
  //     standalone node_modules, so one route key is enough.)
  outputFileTracingIncludes: {
    "/api/streamdeck/devices": [
      "./node_modules/node-hid/prebuilds/**",
      "./node_modules/@julusian/**/prebuilds/**",
      "./node_modules/@napi-rs/canvas-*/icudtl.dat",
    ],
  },
  // Don't drag the launcher's own electron-builder output into the
  // standalone — that creates a recursive ~300 MB include.
  outputFileTracingExcludes: {
    "*": [
      "launcher/**",
      "nexus-cross/**",
      "public/downloads/**",
      "**/node_modules/electron/**",
      "**/node_modules/electron-builder/**",
      "**/node_modules/@electron/**",
      "**/node_modules/typescript/**",
      "**/node_modules/@types/**",
      "**/node_modules/eslint*/**",
      "**/node_modules/@eslint*/**",
      "**/node_modules/@tailwindcss/**",
      "**/node_modules/tailwindcss/**",
      "**/node_modules/shadcn/**",
      "**/.cache/**",
    ],
  },
};

export default nextConfig;
