import { randomUUID } from "node:crypto";
import { readJson, writeJson } from "./index";

const FILE = "network-scans.json";
const RETENTION_MS = 60 * 60 * 1000; // 1 hour
/** Hard cap on number of scans retained, regardless of age. Stops a
 *  burst of scans within the retention window from growing unbounded. */
const MAX_ENTRIES = 50;

interface Entry {
  id: string;
  data: unknown;
  created_at: number;
}

function read(): Entry[] {
  return readJson<Entry[]>(FILE, []);
}

function write(entries: Entry[]) {
  writeJson(FILE, entries);
}

/** Apply BOTH age and count limits. Keeps the most-recent MAX_ENTRIES
 *  within the retention window. */
function prune(entries: Entry[]): Entry[] {
  const cutoff = Date.now() - RETENTION_MS;
  const recent = entries.filter((e) => e.created_at >= cutoff);
  if (recent.length <= MAX_ENTRIES) return recent;
  return recent
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_ENTRIES);
}

export function saveScan(data: unknown): string {
  const id = randomUUID();
  const entries = prune(read());
  entries.push({ id, data, created_at: Date.now() });
  write(entries);
  return id;
}

export function getScan(id: string): unknown | null {
  // Prune on read too — without this, a long-idle app would keep
  // serving entries older than the retention window until the next
  // save. We also write the pruned list back so the file shrinks even
  // when no new scans arrive.
  const raw = read();
  const pruned = prune(raw);
  if (pruned.length !== raw.length) write(pruned);
  return pruned.find((e) => e.id === id)?.data ?? null;
}
