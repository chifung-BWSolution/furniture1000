import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const installer = dirname(fileURLToPath(import.meta.url));
const root = resolve(installer, '../../..');
const output = process.argv[2];
if (!output) throw new Error('Usage: node build.mjs <staging-directory>');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Build with Windows x64 Node.js.');
const licenses = join(output, 'licenses');
await mkdir(licenses, { recursive: true });
const result = await build({
  entryPoints: [join(installer, '../worker.mjs')],
  outfile: join(output, 'worker.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: "import { createRequire as __fdsCreateRequire } from 'node:module'; const require = __fdsCreateRequire(import.meta.url);" },
  metafile: true,
  legalComments: 'eof',
});
await copyFile(process.execPath, join(output, 'node.exe'));
await copyFile(join(installer, '../skp_build.rb'), join(output, 'skp_build.rb'));
await copyFile(join(installer, '../skp_seed.rb'), join(output, 'skp_seed.rb'));
await copyFile(join(installer, '../skp_preview.rb'), join(output, 'skp_preview.rb'));
const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
if (!response.ok) throw new Error(`Cannot fetch matching Node.js license: ${response.status}`);
await writeFile(join(licenses, 'Node-LICENSE.txt'), await response.text());
const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const match = input.replaceAll('\\', '/').match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (match) packages.add(match[1]);
}
for (const name of packages) {
  const folder = join(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
  let found = false;
  for (const filename of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE']) {
    try {
      const contents = await readFile(join(folder, filename), 'utf8');
      await writeFile(join(licenses, `${name.replaceAll('/', '-')}-LICENSE.txt`), contents);
      found = true;
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // tr46 0.0.3's npm archive omitted its MIT notice; keep the upstream notice with the builder.
  if (!found && name === 'tr46' && pkg.version === '0.0.3') {
    await copyFile(join(installer, 'licenses/tr46-LICENSE.txt'), join(licenses, 'tr46-LICENSE.txt'));
    found = true;
  }
  if (!found) throw new Error(`Missing distribution license for ${name}`);
  await writeFile(join(licenses, `${name.replaceAll('/', '-')}-package.json`), JSON.stringify({ name, version: pkg.version, license: pkg.license }, null, 2));
}
await writeFile(join(output, 'build-info.json'), JSON.stringify({ builtAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch }, null, 2));
console.log(`Bundled Worker with Node ${process.version}; included ${packages.size} dependency licenses.`);
