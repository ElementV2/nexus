import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Tests live in /tests (kept out of the three apps' src trees so they
 * never land in a shipped bundle or an Electron build/ output). They run
 * in the Node environment — we cover pure, hardware-independent logic
 * (OSC codec, URL/version helpers, config validators), not React UI.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
});
