// FILE: apps/api/src/crypto/secrets.ts
/**
 * AES-256-GCM credential store.
 * IV is 12 random bytes per encryption. Tag is verified by GCM before plaintext is returned.
 * AAD binds ciphertext to hostId and field name so a blob cannot be swapped across hosts.
 * Never log plaintext, keys, or ciphertext together with identifiers in the same line.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

export interface KeyRing {
  activeId: string;
  keys: Record<string, Buffer>;
}

/** Parse DATA_KEY_RING=`k1:<b64>,k0:<b64>` with the first id active. */
export function loadKeyRing(raw: string): KeyRing {
  const keys: Record<string, Buffer> = {};
  const parts = raw.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("DATA_KEY_RING empty");
  for (const part of parts) {
    const [id, b64] = part.split(":");
    const key = Buffer.from(b64 ?? "", "base64");
    if (!id || key.length !== 32) throw new Error("key must be 32 bytes");
    keys[id] = key;
  }
  return { activeId: parts[0].split(":")[0], keys };
}

export interface Sealed {
  keyId: string;
  iv: string;
  tag: string;
  ciphertext: string;
  aad: string;
}

export function seal(ring: KeyRing, hostId: string, field: "password" | "privateKey", plain: string): Sealed {
  const aad = `${hostId}:${field}`;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", ring.keys[ring.activeId], iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LEN) throw new Error("unexpected tag length");
  return {
    keyId: ring.activeId,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    aad,
  };
}

export function open(ring: KeyRing, sealed: Sealed): string {
  const key = ring.keys[sealed.keyId];
  if (!key) throw new Error("unknown keyId");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(Buffer.from(sealed.aad));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  // Auth tag mismatch throws before any caller can use plaintext.
  const plain = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
