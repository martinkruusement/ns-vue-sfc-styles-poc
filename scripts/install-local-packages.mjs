// Reinstalls the packages this project takes from local folders (`file:` dependencies).
// npm does not re-copy a `file:` dependency that is already installed, so a rebuilt package
// would be ignored: remove each installed copy first, then let `npm install` copy it again.
import { readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const local = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter(([, spec]) => spec.startsWith('file:'))
  .map(([name]) => name);

for (const name of local) {
  rmSync(new URL(`../node_modules/${name}`, import.meta.url), { recursive: true, force: true });
  console.log(`removed node_modules/${name}`);
}

const result = spawnSync('npm', ['install'], { stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(result.status ?? 1);
