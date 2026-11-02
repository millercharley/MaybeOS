#!/usr/bin/env node
/**
 * Export the single-organisation subset, for the public repo (OSS-02).
 *
 * MaybeOS is one codebase that does two things: it runs a co-op, and it runs
 * a business hosting co-ops. The first is what a self-hoster wants and what
 * Apache 2.0 is for. The second — the cross-org console, MaybeOS's own plan
 * table and platform fee — is the business, and publishing it is publishing
 * the means to compete with it.
 *
 * So the public repo is this repo minus that layer, and minus the internal
 * operating documents. Two things about how:
 *
 * **It is not a fork.** A GitHub fork or a `git clone` carries all 591
 * commits, and those commits contain real members' names and email addresses
 * from before they were scrubbed (OPS-38). This writes a plain tree with no
 * history at all; the caller runs `git init` and makes one commit. That is
 * the whole reason the script exists rather than a button being pressed.
 *
 * **It is one script, not a second codebase.** A hand-maintained fork is
 * stale in a month and then it is a liability: issues filed against code
 * nobody runs, a security fix landing on one side only. Everything here is
 * derived from HEAD on every run, so the two cannot drift.
 *
 * It fails closed. A missing patch anchor, a surviving real address, a dirty
 * working tree — any of them aborts before anything is written, because the
 * failure mode this guards against is publishing, and publishing is the one
 * thing that cannot be taken back.
 *
 *   node tools/export-single-org.js ../maybeos-public
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');

/* ───────────────────────── what does not ship ───────────────────────── */

/**
 * Each entry is a path or a directory prefix, with the reason it is held
 * back. The reasons are here rather than in a commit message because the
 * question "why is this not in the public repo?" gets asked by whoever next
 * changes this list.
 */
const EXCLUDE = [
  ['project-os/', 'Internal operating documents — decision log, session notes, state, audit brief. Not product, and this is where the member PII lived.'],
  ['.claude/', "Agent configuration for this working copy. Not product."],
  ['tools/', 'Operations scripts that talk to production: smoke tests, a Stripe billing check, a write probe. Includes this script.'],
  ['.github/', 'CI here is pinned to the branch Netlify deploys from (OPS-41). The public repo wants its own, against its own default branch.'],

  // The cross-org console. `platform.module.ts` itself stays and is patched
  // below: it exports `AuditService`, which `commons`, `org` and `member` all
  // import. The module is shared infrastructure; only the console is not.
  ['apps/api/src/modules/platform/platform.controller.ts', 'The cross-org console: list every co-op, suspend one, restore one, set its plan.'],
  ['apps/api/src/modules/platform/platform.service.ts', 'Serves that console. Reads across organisations by design.'],
  ['apps/api/src/modules/platform/dto/platform.dto.ts', 'Request shapes for the console only.'],
  ['apps/api/src/modules/platform/__tests__/platform.spec.ts', 'Tests the console.'],
  ['apps/web/app/(app)/(dashboard)/platform/page.tsx', "The console's page."],
];

/* ───────────────────────── what gets rewritten ──────────────────────── */

/**
 * Applied to the exported copy, never to this repo. Every anchor must match
 * exactly once: if a refactor moves one, this stops rather than quietly
 * publishing an unpatched file. That is the whole point of listing them.
 */
const PATCH = [
  {
    file: 'apps/api/src/modules/platform/platform.module.ts',
    why: 'Keep AuditService, which three modules import; drop the console.',
    edits: [
      ["import { PlatformService } from './platform.service';\n", ''],
      ["import { PlatformController } from './platform.controller';\n", ''],
      ['  controllers: [PlatformController],\n', ''],
      [
        '  providers: [PrismaService, PlatformService, AuditService, StorageHealthIndicator],',
        '  providers: [PrismaService, AuditService, StorageHealthIndicator],',
      ],
    ],
  },
  {
    file: 'apps/api/src/app.module.ts',
    why: 'PlatformModule still loads — AuditService lives in it — but with no controller.',
    edits: [],
  },
];

/* ─────────────────────────── the PII preflight ──────────────────────── */

const ADDRESS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const DOC_DOMAINS = ['example.com', 'example.org', 'example.net'];
const DOC_SUFFIXES = ['.example', '.test', '.invalid', '.localhost'];
const OUR_DOMAINS = ['maybeos.org', 'maybeos.app', 'maybeitsfate.com', 'maybeitsfate.community', 'maybe-its-fate.com', 'mail.maybeitsfate.com'];
const PLACEHOLDERS = ['a.org', 'b.co', 'b.com', 'b.org', 'c.com', 'd.com', 'other.org', 'x.co', 'x.org', 'flex.com', 'neighbor.com', 'sunrise.coop'];
const CALENDAR = ['group.calendar.google.com', 'group.v.calendar.google.com'];

const atOrUnder = (domain, allowed) => domain === allowed || domain.endsWith(`.${allowed}`);

/**
 * The same rule as `apps/api/src/common/testing/address-scan.ts`, which the
 * jest suite enforces over `apps/`. Repeated here on purpose: this runs over
 * the *exported tree*, including the files that suite does not scan, and it
 * has to run even when somebody exports without running the tests.
 */
function allowedDomain(domain) {
  const d = domain.toLowerCase();
  if (CALENDAR.some((s) => atOrUnder(d, s))) return true;
  if (DOC_SUFFIXES.some((s) => d.endsWith(s))) return true;
  if (DOC_DOMAINS.some((a) => atOrUnder(d, a))) return true;
  if (OUR_DOMAINS.some((a) => atOrUnder(d, a))) return true;
  return PLACEHOLDERS.includes(d);
}

const TEXT = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.sql', '.prisma', '.md', '.yml', '.yaml', '.txt', '.html', '.css', '.sh', '.gs'];

/* ─────────────────────────────── the run ────────────────────────────── */

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8' });
const die = (message, detail) => {
  console.error(`\n  REFUSED: ${message}\n`);
  if (detail) console.error(detail.replace(/^/gm, '    ') + '\n');
  process.exit(1);
};

const dest = process.argv[2];
if (!dest) die('give me somewhere to write to:  node tools/export-single-org.js ../maybeos-public');
const OUT = path.resolve(dest);
if (OUT === REPO) die('that is this repo');

// Exporting an uncommitted state publishes something no commit describes.
if (git('status', '--porcelain').trim()) {
  die('the working tree is dirty', git('status', '--short'));
}

const tracked = git('ls-files').split('\n').filter(Boolean);
const isExcluded = (file) => EXCLUDE.find(([p]) => (p.endsWith('/') ? file.startsWith(p) : file === p));

const kept = [];
const dropped = [];
for (const file of tracked) {
  (isExcluded(file) ? dropped : kept).push(file);
}

// An exclude entry that matches nothing is a path that moved, and silence
// about it means shipping what it meant to hold back.
const idle = EXCLUDE.filter(([p]) => !dropped.some((f) => (p.endsWith('/') ? f.startsWith(p) : f === p)));
if (idle.length) {
  die('these exclusions matched no file — a path has moved', idle.map(([p]) => p).join('\n'));
}

// Write the tree.
fs.rmSync(OUT, { recursive: true, force: true });
for (const file of kept) {
  const target = path.join(OUT, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(REPO, file), target);
}

// Patch it, failing on any anchor that no longer matches exactly once.
for (const { file, edits } of PATCH) {
  if (!edits.length) continue;
  const target = path.join(OUT, file);
  if (!fs.existsSync(target)) die(`patch target is not in the export: ${file}`);
  let body = fs.readFileSync(target, 'utf8');
  for (const [find, replace] of edits) {
    const count = body.split(find).length - 1;
    if (count !== 1) {
      die(`patch anchor matched ${count} times in ${file}, expected 1`, find);
    }
    body = body.replace(find, replace);
  }
  fs.writeFileSync(target, body);
}

// Preflight: no real address may leave the building.
const leaks = [];
for (const file of kept) {
  if (!TEXT.includes(path.extname(file))) continue;
  const body = fs.readFileSync(path.join(OUT, file), 'utf8');
  body.split('\n').forEach((line, i) => {
    for (const found of line.match(ADDRESS) ?? []) {
      const domain = found.slice(found.lastIndexOf('@') + 1);
      if (!allowedDomain(domain)) leaks.push(`${file}:${i + 1}  ${found}`);
    }
  });
}
if (leaks.length) {
  fs.rmSync(OUT, { recursive: true, force: true });
  die(`${leaks.length} address(es) at domains the rule refuses — nothing written`, leaks.join('\n'));
}

// Report: what in the kept tree still reaches for what was held back.
const dangling = [];
const excludedStems = dropped
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((f) => path.basename(f).replace(/\.(ts|tsx)$/, ''));
for (const file of kept) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const body = fs.readFileSync(path.join(OUT, file), 'utf8');
  for (const stem of new Set(excludedStems)) {
    if (body.includes(`./${stem}'`) || body.includes(`/${stem}'`)) {
      dangling.push(`${file}  ->  ${stem}`);
    }
  }
}

console.log(`\n  wrote ${kept.length} files to ${OUT}`);
console.log(`  held back ${dropped.length}:\n`);
for (const [p, why] of EXCLUDE) {
  const n = dropped.filter((f) => (p.endsWith('/') ? f.startsWith(p) : f === p)).length;
  console.log(`    ${String(n).padStart(3)}  ${p}`);
  console.log(`         ${why}`);
}
console.log('\n  PII preflight: clean.');

if (dangling.length) {
  console.log(`\n  ${dangling.length} reference(s) in the export still point at held-back files:\n`);
  for (const d of dangling) console.log(`    ${d}`);
  console.log('\n  These need a patch above, or the file needs to ship after all.');
} else {
  console.log('  Dangling references: none.');
}

console.log(`
  No git history was written, deliberately — a fork or a clone would carry
  every commit, and the old ones contain members' names and addresses.

  To publish:
      cd ${OUT} && git init && git add -A && git commit -m "MaybeOS, single organisation"

  Still undecided, and not this script's call:
    - MaybeOS's plan table and platform fee (apps/api/src/modules/stripe/
      maybeos-plans.ts, public-pricing.*, adoption-scan.*). A self-hoster owes
      MaybeOS nothing, so the application fee should be absent rather than
      zero — and with no platform fee, Stripe Connect may not be needed at
      all: they would use their own account directly. That is an architecture
      decision, not an exclusion.
    - Whether a self-hoster should be able to create a second organisation at
      all, or whether the seeded one is the only one.
`);
