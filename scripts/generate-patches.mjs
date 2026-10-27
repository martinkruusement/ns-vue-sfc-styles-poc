// Regenerates patches/*.patch: the pull requests of this series as patch-package patches for the
// published package versions this app depends on. For the author of the series; macOS and Linux.
//
// Each patch is the difference between a build of upstream `main` and a build of the branch that
// merges every pull request of the series. A patch is only written when every file it touches is
// identical in the published package and in the `main` build, and after it has been applied to a
// copy of the published package with a result identical to the series build.
//
// Inputs (override with environment variables; relative paths are resolved from this folder):
//   NS_MAIN         NativeScript clone at upstream main, built (`npx nx run-many -t build -p core,vite,webpack5`)
//   NS_INTEGRATION  NativeScript clone with the merged series, built the same way
//   NSVUE_FIX       nativescript-vue clone with the merged series, built (`npm run build`)
//   TAILWIND_FIX    tailwind clone with the merged series
// nativescript-vue and tailwind are compared with their published releases, which match their
// upstream main.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const work = path.resolve(appRoot, '..', 'ns-css-improvements');
const NS_MAIN = path.resolve(process.env.NS_MAIN ?? path.join(work, 'NativeScript'));
const NS_INTEGRATION = path.resolve(process.env.NS_INTEGRATION ?? path.join(work, 'integration', 'NativeScript'));
const NSVUE_FIX = path.resolve(process.env.NSVUE_FIX ?? path.join(work, 'integration', 'nativescript-vue'));
const TAILWIND_FIX = path.resolve(process.env.TAILWIND_FIX ?? path.join(work, 'integration', 'tailwind'));

const pkgJson = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };

// base: what the release was built from; fix: the same package with the series applied.
const PACKAGES = [
  { name: '@nativescript/vite', base: path.join(NS_MAIN, 'dist/packages/vite'), fix: path.join(NS_INTEGRATION, 'dist/packages/vite') },
  { name: '@nativescript/webpack', base: path.join(NS_MAIN, 'dist/packages/webpack5'), fix: path.join(NS_INTEGRATION, 'dist/packages/webpack5') },
  { name: '@nativescript/core', base: path.join(NS_MAIN, 'dist/packages/core'), fix: path.join(NS_INTEGRATION, 'dist/packages/core') },
  { name: 'nativescript-vue', base: null, fix: NSVUE_FIX },
  { name: '@nativescript/tailwind', base: null, fix: TAILWIND_FIX },
];

// Files that are not part of the change: source maps, metadata and docs.
const SKIP = /(\.map|\/package\.json|\/README\.md|\/CHANGELOG\.md|\/LICENSE)$/;

const tmp = mkdtempSync(path.join(tmpdir(), 'sfc-patches-'));
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });

function exactVersion(name) {
  const spec = deps[name];
  if (!spec || !/^\d+\.\d+\.\d+$/.test(spec)) throw new Error(`${name} must be pinned to an exact version in package.json (found ${spec})`);
  return spec;
}

// The files npm would publish, unpacked: a registry spec (`name@version`) or a package folder.
// Lifecycle scripts are skipped, so packing a checkout never triggers a build.
function packed(spec, label) {
  const dir = path.join(tmp, label);
  mkdirSync(dir, { recursive: true });
  const tgz = run('npm', ['pack', spec, '--silent', '--ignore-scripts', '--pack-destination', dir]).trim().split('\n').pop();
  run('tar', ['-xzf', path.join(dir, tgz), '-C', dir, '--strip-components=1']);
  rmSync(path.join(dir, tgz));
  return dir;
}

function files(root, rel = '') {
  const out = [];
  for (const entry of readdirSync(path.join(root, rel))) {
    if (entry === 'node_modules') continue;
    const r = path.join(rel, entry);
    if (statSync(path.join(root, r)).isDirectory()) out.push(...files(root, r));
    else out.push(r);
  }
  return out;
}

const same = (a, b) => existsSync(a) && existsSync(b) && readFileSync(a).equals(readFileSync(b));
const patchName = (name, version) => `${name.replace('/', '+')}+${version}.patch`;
const patchesDir = path.join(appRoot, 'patches');
mkdirSync(patchesDir, { recursive: true });

let failed = false;
const fail = (message) => {
  console.error(message);
  failed = true;
};

for (const pkg of PACKAGES) {
  const version = exactVersion(pkg.name);
  const target = path.join(patchesDir, patchName(pkg.name, version));
  // Patches for other versions of this package are stale; so is this one until it is rewritten.
  for (const old of readdirSync(patchesDir).filter((f) => f.startsWith(`${pkg.name.replace('/', '+')}+`) && f.endsWith('.patch'))) {
    rmSync(path.join(patchesDir, old));
  }
  for (const dir of [pkg.base, pkg.fix]) if (dir && !existsSync(dir)) throw new Error(`${pkg.name}: missing build at ${dir}`);
  const pub = packed(`${pkg.name}@${version}`, `published/${pkg.name}`);
  const base = pkg.base ? packed(pkg.base, `base/${pkg.name}`) : pub;
  const fix = packed(pkg.fix, `fix/${pkg.name}`);
  const pubFiles = new Set(files(pub));
  const differing = [...new Set([...files(base), ...files(fix)])]
    .filter((f) => !SKIP.test(`/${f}`))
    .filter((f) => !same(path.join(base, f), path.join(fix, f)))
    .sort();
  // A change to a file the published package does not ship cannot be expressed as a patch for it.
  const notShipped = differing.filter((f) => !pubFiles.has(f) && existsSync(path.join(base, f)));
  const changed = differing.filter((f) => pubFiles.has(f) || !existsSync(path.join(base, f)));
  const notReleased = changed.filter((f) => pubFiles.has(f) && !same(path.join(pub, f), path.join(base, f)));
  if (notShipped.length) fail(`${pkg.name}@${version}: the series changes files the published package does not contain: ${notShipped.join(', ')}`);
  if (notReleased.length) fail(`${pkg.name}@${version}: the published files differ from the base build in ${notReleased.join(', ')}; the patch would not apply`);
  if (notShipped.length || notReleased.length) continue;

  // Stage only the changed files, so the diff contains nothing else.
  const stage = path.join(tmp, 'stage', pkg.name);
  for (const side of ['a', 'b']) mkdirSync(path.join(stage, side), { recursive: true });
  for (const f of changed) {
    if (existsSync(path.join(base, f))) cpSync(path.join(base, f), path.join(stage, 'a', f));
    if (existsSync(path.join(fix, f))) cpSync(path.join(fix, f), path.join(stage, 'b', f));
  }
  // Independent of the user's git configuration: no renames, no external diff tools, no quoting.
  const diff = spawnSync('git', ['-c', 'core.quotepath=off', 'diff', '--no-index', '--no-renames', '--no-ext-diff', '--no-textconv', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', 'a', 'b'], { cwd: stage, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (diff.status !== 1 && diff.status !== 0) throw new Error(diff.stderr);
  if (/^Binary files /m.test(diff.stdout)) {
    fail(`${pkg.name}@${version}: the series changes a binary file, which a patch cannot carry`);
    continue;
  }
  const prefix = `node_modules/${pkg.name}/`;
  const patch = diff.stdout
    // new and deleted files name the existing side twice (`a/b/x b/b/x`, `a/a/x b/a/x`)
    .replace(/^(diff --git )a\/[ab]\/(\S+) b\/[ab]\/(\S+)$/gm, `$1a/${prefix}$2 b/${prefix}$3`)
    .replace(/^--- a\/a\//gm, `--- a/${prefix}`)
    .replace(/^\+\+\+ b\/b\//gm, `+++ b/${prefix}`);

  // Apply it to a copy of the published package and compare the result with the series build.
  const check = path.join(tmp, 'check', pkg.name);
  cpSync(pub, path.join(check, 'node_modules', pkg.name), { recursive: true });
  const patchFile = path.join(tmp, 'check', `${pkg.name.replace('/', '+')}.patch`);
  writeFileSync(patchFile, patch);
  const applied = spawnSync('git', ['apply', patchFile], { cwd: check, encoding: 'utf8' });
  const wrong = applied.status !== 0 ? [applied.stderr.trim()] : changed.filter((f) => {
    const result = path.join(check, 'node_modules', pkg.name, f);
    return existsSync(path.join(fix, f)) ? !same(result, path.join(fix, f)) : existsSync(result);
  });
  if (wrong.length) {
    fail(`${pkg.name}@${version}: the patch does not reproduce the series build on the published package: ${wrong.join(', ')}`);
    continue;
  }
  writeFileSync(target, patch);
  console.log(`${path.relative(appRoot, target)}: ${changed.length} files`);
}
rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
