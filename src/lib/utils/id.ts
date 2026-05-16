/**
 * Short random ID for client-side entities (overlays, elements, etc.).
 *
 * 8 chars of base-36 ≈ 41 bits of entropy — collision risk negligible
 * within a single user's overlay set. Not cryptographic.
 */
export function createId(): string {
  return Math.random().toString(36).substring(2, 10);
}
