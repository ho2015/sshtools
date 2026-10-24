// FILE: apps/api/src/ws/tickets.ts
/**
 * One-time connect tickets. Store only a hash. TTL 30s. Consume on first successful handshake.
 * Do not put the session JWT in the WebSocket query string.
 */
import { createHash, randomBytes } from "node:crypto";

export interface Ticket {
  hash: string;
  userId: string;
  sessionId: string;
  mode: "control" | "shadow";
  origin: string;
  exp: number;
}

const mem = new Map<string, Ticket>();

export function issueTicket(t: Omit<Ticket, "hash" | "exp">): string {
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  mem.set(hash, { ...t, hash, exp: Date.now() + 30_000 });
  return raw;
}

export function consumeTicket(raw: string, origin: string): Ticket | null {
  const hash = createHash("sha256").update(raw).digest("hex");
  const row = mem.get(hash);
  mem.delete(hash);
  if (!row || row.exp < Date.now() || row.origin !== origin) return null;
  return row;
}
