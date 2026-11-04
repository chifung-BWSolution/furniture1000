import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function findBlender(source = process.env) {
  if (source.FDS_BLENDER_EXE) return existsSync(source.FDS_BLENDER_EXE) ? source.FDS_BLENDER_EXE : null;
  const root = join(source.ProgramFiles || source.PROGRAMFILES || 'C:\\Program Files', 'Blender Foundation');
  let versions = [];
  try { versions = readdirSync(root).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((v) => join(root, v, 'blender.exe')); } catch {}
  return [...versions, ...String(source.PATH || '').split(';').filter(Boolean).map((p) => join(p, 'blender.exe'))].find(existsSync) || null;
}
