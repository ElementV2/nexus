import { createHash } from "node:crypto";

/**
 * OBS WebSocket v5 protocol helpers — opcode constants, the event
 * subscription bitmask, and the SHA-256 challenge/response that auths
 * a session against a password-protected obs-websocket server.
 *
 * Spec reference:
 *   github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md
 */

// ───────────────────────────── Opcodes ──────────────────────────────

export const OP_HELLO = 0;
export const OP_IDENTIFY = 1;
export const OP_IDENTIFIED = 2;
export const OP_REIDENTIFY = 3;
export const OP_EVENT = 5;
export const OP_REQUEST = 6;
export const OP_REQUEST_RESPONSE = 7;
export const OP_REQUEST_BATCH = 8;
export const OP_REQUEST_BATCH_RESPONSE = 9;

// ─────────────────────── Event subscription bits ────────────────────

export const EVENT_SUB = {
  None: 0,
  General: 1 << 0,
  Config: 1 << 1,
  Scenes: 1 << 2,
  Inputs: 1 << 3,
  Transitions: 1 << 4,
  Filters: 1 << 5,
  Outputs: 1 << 6,
  SceneItems: 1 << 7,
  MediaInputs: 1 << 8,
  Vendors: 1 << 9,
  Ui: 1 << 10,
  /** Volume meters fire at ~60 Hz — opt-in to keep the SSE bus quiet. */
  InputVolumeMeters: 1 << 16,
  InputActiveStateChanged: 1 << 17,
  InputShowStateChanged: 1 << 18,
  SceneItemTransformChanged: 1 << 19,
} as const;

/**
 * Default subscription — everything *except* the 60 Hz volume meter
 * stream. The UI can re-identify with `WithVolumeMeters` when the
 * audio mixer panel is open.
 */
export const DEFAULT_EVENT_SUBSCRIPTIONS =
  EVENT_SUB.General |
  EVENT_SUB.Config |
  EVENT_SUB.Scenes |
  EVENT_SUB.Inputs |
  EVENT_SUB.Transitions |
  EVENT_SUB.Filters |
  EVENT_SUB.Outputs |
  EVENT_SUB.SceneItems |
  EVENT_SUB.MediaInputs |
  EVENT_SUB.Vendors |
  EVENT_SUB.Ui |
  EVENT_SUB.InputActiveStateChanged |
  EVENT_SUB.InputShowStateChanged |
  EVENT_SUB.SceneItemTransformChanged;

export const SUBSCRIPTIONS_WITH_METERS =
  DEFAULT_EVENT_SUBSCRIPTIONS | EVENT_SUB.InputVolumeMeters;

// ────────────────────────── Auth helpers ────────────────────────────

/**
 * Compute the challenge response per obs-websocket v5 spec:
 *
 *   secret      = base64(sha256(password + salt))
 *   response    = base64(sha256(secret + challenge))
 *
 * Salt and challenge come from the server's Hello message.
 */
export function buildAuthResponse(
  password: string,
  salt: string,
  challenge: string
): string {
  const secret = createHash("sha256")
    .update(password + salt)
    .digest("base64");
  return createHash("sha256")
    .update(secret + challenge)
    .digest("base64");
}
