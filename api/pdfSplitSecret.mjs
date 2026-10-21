import { createHash, timingSafeEqual } from 'node:crypto';

/** Trim pasted secrets, then compare equal-length digests. */
export function secretsMatch(provided, expected) {
  const left = String(provided ?? '').trim();
  const right = String(expected ?? '').trim();
  if (!left || !right) return false;
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

export function readEnv(value) {
  return String(value ?? '').trim();
}
