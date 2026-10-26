// Asia/Shanghai has a fixed UTC+8 offset. End is exclusive.
export function documentParseWindowOpen(now = new Date()) {
  const hour = (now.getUTCHours() + 8) % 24;
  return hour >= 23 || hour < 9;
}
export class ParseWindowClosed extends Error {}
export function requireDocumentParseWindow() {
  if (!documentParseWindowOpen()) throw new ParseWindowClosed('Waiting for 23:00 Asia/Shanghai');
}
