// Fetches the improved packages this app is built with, for a machine that does not have the
// checkouts yet: clones the `sfc-styles-demo` branch of each fork into
// ../ns-css-improvements/integration/ (where the `file:` dependencies in package.json point),
// installs their dependencies, then builds and installs them here (npm run local:update).
// Each branch merges every pull request of the series into that repository's `main`.
import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BRANCH = 'sfc-styles-demo';
const FORKS = {
  NativeScript: 'https://github.com/martinkruusement/NativeScript.git',
  'nativescript-vue': 'https://github.com/martinkruusement/nativescript-vue.git',
  tailwind: 'https://github.com/martinkruusement/tailwind.git',
};

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const integration = path.resolve(appRoot, '..', 'ns-css-improvements', 'integration');

const run = (cmd, args, cwd) => {
  console.log(`\n$ ${[cmd, ...args].join(' ')}   (in ${cwd})`);
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

mkdirSync(integration, { recursive: true });
for (const [name, url] of Object.entries(FORKS)) {
  const dir = path.join(integration, name);
  if (existsSync(dir)) {
    console.log(`\n${dir} exists, leaving it as it is`);
    continue;
  }
  run('git', ['clone', '--filter=blob:none', '--single-branch', '--branch', BRANCH, url, dir], integration);
}
run('npm', ['ci'], path.join(integration, 'NativeScript'));
run('npm', ['ci'], path.join(integration, 'nativescript-vue'));
run('npm', ['run', 'local:update'], appRoot);
