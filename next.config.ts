import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["sharp"],
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
  // Don't drag the launcher's own electron-builder output into the
  // standalone — that creates a recursive ~300 MB include.
  outputFileTracingExcludes: {
    "*": [
      "launcher/**",
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
