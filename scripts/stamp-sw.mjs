/* stamp-sw.mjs — derive the service worker's shell cache name from the shell's
   own contents.

   A service worker serves the shell from its cache, so the deployed files only
   reach anyone when the cache is retired. That was VERSION's job, bumped by
   hand — and a bump that gets forgotten is invisible to the person who forgot
   it: their own browser installed the new worker while they were testing. It
   only shows up as someone else running last week's app.js.

   So SHELL_REV holds a hash of the shell's code and markup, and names the shell
   cache. Change any of those files and the old shell is retired on the next
   activate, with no bookkeeping. VERSION stays hand-held for the times you want
   to nuke everything, imagery included.

   The file list is read out of sw.js's own SHELL_ASSETS, so the two cannot
   drift. Data JSON is skipped -- it is served network-first and refreshes on its
   own -- as are images, which are bytes the hash would only churn.

   Run: node scripts/stamp-sw.mjs          # rewrite SHELL_REV in place
        node scripts/stamp-sw.mjs --check  # verify only; non-zero if stale

   Both modes are idempotent, and --check is what CI runs. */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SW = 'sw.js';
const CHECK = process.argv.includes('--check');

/* What actually constitutes the shell: markup, code, styles, and the manifest.
   Everything else in SHELL_ASSETS is data or imagery. */
const SHELL_CODE = /\.(html|js|css|webmanifest)$/i;

/* Pull a top-level `const <name> = [ ... ];` array literal out of source text,
   scanning for the bracket that balances and skipping anything inside strings or
   comments so a `]` in a url can't end the scan early. */
function extractArrayLiteral(src, name) {
  const decl = new RegExp(`const\\s+${name}\\s*=\\s*\\[`).exec(src);
  if (!decl) throw new Error(`${SW}: no \`const ${name} = [\` declaration found`);
  const start = src.indexOf('[', decl.index);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      for (i++; i < src.length && src[i] !== quote; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${SW}: \`${name}\` array literal is unterminated`);
}

const src = await readFile(join(ROOT, SW), 'utf8');

const assets = new Function(`return ${extractArrayLiteral(src, 'SHELL_ASSETS')}`)();
const files = [...new Set(
  assets
    .map((u) => String(u).replace(/^\.\//, ''))
    .filter((u) => SHELL_CODE.test(u)),
)].sort();

if (!files.length) {
  console.error(`${SW}: SHELL_ASSETS lists no code or markup to hash — has it changed shape?`);
  process.exit(1);
}

/* Path is hashed alongside contents, so renaming a file is a change even when
   its bytes are identical. */
const h = createHash('sha256');
const missing = [];
for (const f of files) {
  try {
    h.update(f).update('\0').update(await readFile(join(ROOT, f)));
  } catch {
    missing.push(f);
  }
}

if (missing.length) {
  console.error(`${SW}: SHELL_ASSETS lists ${missing.length} file(s) that do not exist:\n`);
  for (const f of missing) console.error(`  - ${f}`);
  console.error('\nPrecaching one of these fails silently at install time.');
  process.exit(1);
}

const want = h.digest('hex').slice(0, 8);

const REV_RE = /(const\s+SHELL_REV\s*=\s*")([^"]*)(")/;
const found = REV_RE.exec(src);
if (!found) {
  console.error(`${SW}: no \`const SHELL_REV = "…"\` declaration found`);
  process.exit(1);
}
const have = found[2];

if (have === want) {
  console.log(`${SW}: SHELL_REV is current (${want}, over ${files.length} shell files).`);
  process.exit(0);
}

if (CHECK) {
  console.error(`${SW}: SHELL_REV is stale — ${have || '(empty)'} -> ${want}\n`);
  console.error(`Hashed ${files.length} shell files: ${files.join(', ')}`);
  console.error('\nA stale SHELL_REV means the deployed shell keeps being served from the');
  console.error('old cache. Run `node scripts/stamp-sw.mjs` and commit the result.');
  process.exit(1);
}

await writeFile(join(ROOT, SW), src.replace(REV_RE, `$1${want}$3`));
console.log(`${SW}: SHELL_REV ${have || '(empty)'} -> ${want} (over ${files.length} shell files).`);
