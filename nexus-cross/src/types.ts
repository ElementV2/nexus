/**
 * Shared wire types between the Nexus server and the satellite.
 *
 * Mirrors `src/lib/streamdeck/satellite-registry.ts` on the server.
 * Kept inline here so the satellite has no source-import dependency
 * on the Next.js project — the agent is shipped as a standalone
 * binary you can run on any LAN host.
 */

export interface SatelliteDevice {
  serial: string;
  model: string;
  rows: number;
  cols: number;
  iconSize: number;
  productName?: string;
}

/** The slim render payload the server sends (only the visual fields
 *  needed to compose a key image). Mirrors `RenderBindingLite` on the
 *  server side. */
export interface DeckBindingLite {
  preset: {
    label?: string;
    text?: string;
    bgcolor?: string;
    fgcolor?: string;
  };
}

export interface RenderOverride {
  bgcolor?: string;
  fgcolor?: string;
  text?: string;
  badge?: { color: string; symbol?: string };
}

export type SatelliteInMessage =
  | {
      type: "render";
      serial: string;
      keyIndex: number;
      binding: DeckBindingLite | null;
      override?: RenderOverride;
    }
  | { type: "clear"; serial: string; keyIndex: number }
  | { type: "clear-panel"; serial: string }
  | { type: "brightness"; serial: string; percent: number }
  | { type: "hello" };
