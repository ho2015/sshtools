// FILE: apps/api/src/security/ssrf.ts
/**
 * Destination guard.
 * Loopback, link-local, and cloud metadata are always denied.
 * RFC1918 is allowed only when the pinned IP is inside an admin AllowCidr.
 * Call this on every DNS answer and again immediately before connect.
 */
import { BlockList, isIP } from "node:net";

const ALWAYS_DENY = new BlockList();
ALWAYS_DENY.addSubnet("127.0.0.0", 8, "ipv4");
ALWAYS_DENY.addSubnet("169.254.0.0", 16, "ipv4");
ALWAYS_DENY.addSubnet("0.0.0.0", 8, "ipv4");
ALWAYS_DENY.addAddress("169.254.169.254", "ipv4");
ALWAYS_DENY.addAddress("::1", "ipv6");
ALWAYS_DENY.addSubnet("fe80::", 10, "ipv6");
ALWAYS_DENY.addSubnet("fc00::", 7, "ipv6");

export function ipAllowed(ip: string, allow: BlockList): boolean {
  if (!isIP(ip)) return false;
  const family = isIP(ip) === 6 ? "ipv6" : "ipv4";
  if (ALWAYS_DENY.check(ip, family)) return false;
  return allow.check(ip, family);
}
