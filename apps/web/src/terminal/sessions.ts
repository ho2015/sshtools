// apps/api/src/terminal/sessions.ts
import { Client, ClientChannel } from "ssh2";
import type { WebSocket } from "ws";

export type LiveSession = {
  sessionId: string;
  userId: string;
  hostId: string;
  conn: Client;
  stream: ClientChannel | null;
  ws: WebSocket | null;
};

const byId = new Map<string, LiveSession>();

export function countForUser(userId: string) {
  let n = 0;
  for (const s of byId.values()) if (s.userId === userId) n++;
  return n;
}

export function maxSessions() {
  const n = Number(process.env.MAX_SESSIONS_PER_USER ?? 32);
  return Number.isFinite(n) && n > 0 ? n : 32;
}

export function assertCapacity(userId: string) {
  if (countForUser(userId) >= maxSessions()) {
    const err = new Error(`session limit ${maxSessions()}`);
    (err as Error & { status: number }).status = 429;
    throw err;
  }
}

export function put(s: LiveSession) {
  byId.set(s.sessionId, s);
}

export function take(sessionId: string) {
  const s = byId.get(sessionId);
  if (s) byId.delete(sessionId);
  return s;
}
