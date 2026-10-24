// FILE: apps/api/src/security/redact.ts
/** Redact secrets before any audit or cast write. */
const BUILTIN = [
  /password\s*[:=]\s*\S+/gi,
  /authorization:\s*\S+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(AWS_SECRET|TOKEN|API_KEY|PASS)=([^\s]+)/gi,
];

export function redact(input: string, extra: RegExp[] = []): { text: string; hit: boolean } {
  let text = input;
  let hit = false;
  for (const re of [...BUILTIN, ...extra]) {
    text = text.replace(re, () => {
      hit = true;
      return "[REDACTED]";
    });
  }
  return { text, hit };
}
