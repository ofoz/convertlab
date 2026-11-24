// Copies non-TypeScript runtime assets next to the compiled server output.
// tsc only emits .js files, so SQL migrations must be copied explicitly.
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assets = ['db/schema.sql'];

for (const asset of assets) {
  const from = join(root, 'src', asset);
  const to = join(root, 'dist', 'server', asset);
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
  console.log(`copied src/${asset} -> dist/server/${asset}`);
}
