// Switches the packages the series changes between three sources, without touching package.json
// or package-lock.json:
//
//   npm run packages              what is installed right now
//   npm run packages:patched      the published versions with patches/ applied (the default)
//   npm run packages:published    the published versions as they are (the app does not start)
//   npm run packages:local        builds of local checkouts of the branches
//
// `npm install` and `npm ci` run `node scripts/packages.mjs postinstall`, which patches every
// package npm has just installed from the registry and leaves the others as they are. Each package
// records its source in node_modules/<name>/.vue-sfc-styles-demo.json; npm deletes the file when
// it replaces the package, so the record always describes the installed files.
//
// Checkouts for packages:local (relative paths are resolved from the project root):
//   CHECKOUTS                           folder holding the NativeScript, nativescript-vue and
//                                       tailwind clones (default: the parent folder of this project)
//   NS_REPO, NSVUE_REPO, TAILWIND_REPO  one clone each, overriding CHECKOUTS
// A package whose clone is missing keeps its current source. `--no-build` installs what the clones
// have already built.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const patchesDir = path.join(appRoot, 'patches');
const MARKER = '.vue-sfc-styles-demo.json';
const SKIP_POSTINSTALL = 'VUE_SFC_STYLES_DEMO_POSTINSTALL';
const CACHES = ['node_modules/.ns-vite', 'node_modules/.vite', '.ns-vite-build'];

// The clones packages:local installs from, and what each one builds.
const CLONES = {
  NativeScript: {
    env: 'NS_REPO',
    build: ['npx', ['nx', 'run-many', '-t', 'build', '-p', 'core,vite,webpack5']],
    packages: {
      '@nativescript/core': 'dist/packages/core',
      '@nativescript/vite': 'dist/packages/vite',
      '@nativescript/webpack': 'dist/packages/webpack5',
    },
  },
  'nativescript-vue': { env: 'NSVUE_REPO', build: ['npm', ['run', 'build']], packages: { 'nativescript-vue': '.' } },
  tailwind: { env: 'TAILWIND_REPO', build: null, packages: { '@nativescript/tailwind': '.' } },
};

// The packages with a patch: patch-package names a patch <name, "/" as "+">+<version>[+<seq>+<title>].patch.
const PATCHES = {};
for (const file of readdirSync(patchesDir).filter((f) => f.endsWith('.patch')).sort()) {
  const parts = file.slice(0, -'.patch'.length).split('+');
  const scoped = parts[0].startsWith('@');
  const name = scoped ? `${parts[0]}/${parts[1]}` : parts[0];
  (PATCHES[name] ??= { version: parts[scoped ? 2 : 1], files: [] }).files.push(file);
}
const names = Object.keys(PATCHES);

const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};
const pkgDir = (name) => path.join(appRoot, 'node_modules', name);
const installedVersion = (name) => {
  const file = path.join(pkgDir(name), 'package.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).version : null;
};
// What is installed: its version and source. A package without a record is a fresh registry copy.
function current(name) {
  const version = installedVersion(name);
  if (!version) return { source: 'missing', version: null };
  const marker = path.join(pkgDir(name), MARKER);
  return existsSync(marker) ? { ...JSON.parse(readFileSync(marker, 'utf8')), version } : { source: 'published', fresh: true, version };
}
const record = (name, data) => writeFileSync(path.join(pkgDir(name), MARKER), `${JSON.stringify(data, null, 2)}\n`);

// On Windows the command runs through the shell, which needs paths with spaces quoted.
const quote = (arg) => (process.platform === 'win32' && /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
function run(cmd, args, { cwd = appRoot, env = {}, label = [cmd, ...args].join(' ') } = {}) {
  console.log(`\n$ ${label}${cwd === appRoot ? '' : `   (in ${cwd})`}`);
  const result = spawnSync(cmd, args.map(quote), { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  return result.status === 0;
}
// A nested npm install; this script's postinstall step is skipped, the caller records the sources.
const npmInstall = (...args) => run('npm', ['install', '--no-audit', '--no-fund', ...args], { env: { [SKIP_POSTINSTALL]: 'skip' } });

function clearCaches() {
  for (const cache of CACHES) rmSync(path.join(appRoot, cache), { recursive: true, force: true });
  console.log('\nDev-server caches cleared; the next `ns run` uses the packages as they now are.');
}

// Applies (or removes) one package's patches. patch-package applies every patch in a folder, so it
// gets a folder with only these; a patch that is already applied counts as applied.
function patch(name, reverse) {
  const bin = path.join(appRoot, 'node_modules', 'patch-package', 'index.js');
  if (!existsSync(bin)) fail('patch-package is not installed (it is a devDependency); run `npm install` first.');
  const version = installedVersion(name);
  if (version !== PATCHES[name].version) {
    fail(`${name}: the patches are for ${PATCHES[name].version}, ${version} is installed. Pin ${PATCHES[name].version} in package.json, or regenerate the patches (npm run patches:generate).`);
  }
  const dir = mkdtempSync(path.join(appRoot, 'node_modules', '.patches-'));
  try {
    for (const file of PATCHES[name].files) cpSync(path.join(patchesDir, file), path.join(dir, file));
    const args = [bin, '--error-on-fail', '--patch-dir', path.relative(appRoot, dir), ...(reverse ? ['--reverse'] : [])];
    const label = `patch-package${reverse ? ' --reverse' : ''}   (${name})`;
    if (!run(process.execPath, args, { label })) fail(`${name}: the patch did not ${reverse ? 'come off' : 'apply'} (see above). \`npm run packages\` shows where things stand.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
// Each returns whether it changed anything. Local builds are reinstalled by the callers first.
function toPatched(name) {
  const now = current(name);
  if (now.source === 'patched') return false;
  patch(name, false);
  record(name, { source: 'patched' });
  return true;
}
function toPublished(name) {
  const now = current(name);
  if (now.source === 'published' && !now.fresh) return false;
  if (now.source === 'patched') patch(name, true);
  record(name, { source: 'published' });
  return true;
}
// Puts the published copies of these packages back (fresh, unpatched, unrecorded).
function reinstallPublished(toReplace) {
  if (!toReplace.length) return;
  for (const name of toReplace) rmSync(pkgDir(name), { recursive: true, force: true });
  if (!npmInstall()) fail('npm install failed; run it again, then `npm run packages:patched`.');
}

function status() {
  const rows = names.map((name) => {
    const now = current(name);
    const detail = now.source === 'local' ? path.relative(appRoot, now.from) : now.fresh ? 'not patched' : '';
    return [name, now.version ?? '-', now.source, detail];
  });
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i].length)));
  console.log('');
  for (const row of rows) console.log(`  ${row.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]) : cell)).join('  ').trimEnd()}`);
  const sources = new Set(rows.map((r) => r[2]));
  const summary = {
    patched: 'The published versions with the patches applied: the default, the app works.',
    published: 'The published versions as they are: the app does not start.',
    local: 'Builds of local checkouts of the branches.',
    missing: 'Not installed; run `npm install`.',
  };
  console.log(`\n${sources.size === 1 ? summary[[...sources][0]] : 'Mixed sources.'}`);
  console.log('Switch with `npm run packages:patched`, `npm run packages:published` or `npm run packages:local`.');
}

const [mode, ...flags] = process.argv.slice(2);
const locals = () => names.filter((name) => current(name).source === 'local');

switch (mode) {
  case 'status':
    status();
    break;

  case 'patched': {
    const replaced = locals();
    reinstallPublished(replaced);
    let changed = replaced.length > 0;
    for (const name of names) changed = toPatched(name) || changed;
    if (changed) clearCaches();
    status();
    break;
  }

  case 'published': {
    const replaced = locals();
    reinstallPublished(replaced);
    let changed = replaced.length > 0;
    for (const name of names) changed = toPublished(name) || changed;
    if (changed) clearCaches();
    status();
    break;
  }

  case 'local': {
    const base = path.resolve(appRoot, process.env.CHECKOUTS ?? '..');
    const linking = [];
    for (const [repo, clone] of Object.entries(CLONES)) {
      const dir = process.env[clone.env] ? path.resolve(appRoot, process.env[clone.env]) : path.join(base, repo);
      const packages = Object.keys(clone.packages);
      if (!existsSync(dir)) {
        console.log(`${repo}: no checkout at ${dir}, so ${packages.join(', ')} stay${packages.length === 1 ? 's' : ''} as installed.`);
        continue;
      }
      if (clone.build && !flags.includes('--no-build')) {
        if (!existsSync(path.join(dir, 'node_modules'))) fail(`${dir} has no node_modules; run \`npm ci\` there first.`);
        if (!run(clone.build[0], clone.build[1], { cwd: dir })) fail(`The build in ${dir} failed; nothing was installed.`);
      }
      for (const [name, sub] of Object.entries(clone.packages)) {
        const from = path.join(dir, sub);
        if (!existsSync(path.join(from, 'package.json'))) fail(`${name}: nothing built at ${from}; run without --no-build.`);
        linking.push({ name, from });
      }
    }
    if (!linking.length) {
      fail(`No checkouts found in ${base}. Point CHECKOUTS at the folder with the NativeScript, nativescript-vue and tailwind clones, or NS_REPO, NSVUE_REPO and TAILWIND_REPO at the clones.`);
    }
    // --install-links (.npmrc) copies the folders instead of linking them, so their dependencies
    // resolve from this app and it keeps a single @nativescript/core. npm keeps an installed copy
    // whose version matches, so the installed packages go first.
    for (const { name } of linking) rmSync(pkgDir(name), { recursive: true, force: true });
    if (!npmInstall('--no-save', ...linking.map((l) => l.from))) fail('The install failed; `npm run packages:patched` restores the published packages.');
    for (const { name, from } of linking) record(name, { source: 'local', from });
    for (const name of names) if (current(name).fresh) toPatched(name);
    clearCaches();
    status();
    break;
  }

  case 'postinstall': {
    if (process.env[SKIP_POSTINSTALL] === 'skip') break;
    if (!existsSync(path.join(appRoot, 'node_modules', 'patch-package'))) {
      console.log('packages: patch-package is not installed (dev dependencies omitted?), the packages stay unpatched.');
      break;
    }
    const fresh = names.filter((name) => current(name).fresh);
    const kept = locals();
    if (fresh.length && kept.length) {
      console.warn(`\nnpm replaced ${fresh.join(', ')} with the published version while ${kept.join(', ')} are local builds; \`npm run packages:local\` installs the local builds again.`);
    }
    for (const name of fresh) toPatched(name);
    if (fresh.length) clearCaches();
    const sources = [...new Set(names.map((name) => current(name).source))];
    console.log(`packages: ${sources.length === 1 ? sources[0] : 'mixed'} (\`npm run packages\` for details)`);
    break;
  }

  default:
    console.error('usage: node scripts/packages.mjs status|patched|published|local [--no-build]|postinstall');
    process.exit(2);
}
