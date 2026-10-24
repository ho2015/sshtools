// FILE: apps/api/src/forensics/chain.ts
/**
 * Per-session hash chain. Each row stores the previous chain hash and SHA-256 of its payload.
 * Verification walks rows in occurredAt order and recomputes. A gap or edit breaks the chain.
 */
import { createHash } from "node:crypto";

export function payloadHash(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export function nextChain(prev: string, payload: string): { payloadHash: string; chainHash: string } {
  const ph = payloadHash(payload);
  const chainHash = createHash("sha256").update(prev + ph).digest("hex");
  return { payloadHash: ph, chainHash };
}
