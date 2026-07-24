// The staged / journaled commit protocol. The pipeline builds a complete
// generation in a staging tree, validates it, then PROMOTES it into the shipped
// paths under a journal so an interruption is always detected and recoverable -
// never a silently mixed catalog.
//
// The journal (.catalog-build/PROMOTE.json) is written "in-progress" listing the
// target files and the target version hash, then the staged art is mirrored, then
// the staged JSON, then the version token LAST (the seed's trigger appears only
// once every referenced file is in place), then the journal is marked "complete"
// and removed. A stale "in-progress" journal makes every packaging path hard-fail
// (assertNoPendingPromote, wired via prebuild/preandroid/precompile:codex/
// precheck:docs); --recover re-promotes deterministically from retained staging.
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { dirname } from 'node:path';

// Canonical serialisation for the committed catalog JSON: 2-space indent, CRLF
// line endings, no trailing newline (matches public/catalog/faqs.json etc.).
export function serializeJson(obj) {
  return JSON.stringify(obj, null, 2).replace(/\n/g, '\r\n');
}

export function readJournal(journalPath) {
  if (!existsSync(journalPath)) return null;
  try { return JSON.parse(readFileSync(journalPath, 'utf8')); } catch { return { status: 'unreadable' }; }
}

export function isPending(journalPath) {
  const j = readJournal(journalPath);
  return !!j && j.status !== 'complete';
}

const RECOVERY = (
  'Recover with one of:\n' +
  '  A) finish the interrupted promotion from staging:\n' +
  '       npm run update:catalog -- --recover\n' +
  '  B) restore the previous catalog AND clear the journal (both, or the build stays blocked):\n' +
  '       git checkout -- public/catalog src/store/catalogVersion.json src/store/setCatalog.json\n' +
  '       then delete the .catalog-build directory (removes PROMOTE.json + staging)'
);

export function assertNoPendingPromote(journalPath) {
  if (isPending(journalPath)) {
    const st = readJournal(journalPath)?.status ?? 'unknown';
    throw new Error(`Catalog promotion incomplete (${journalPath}: ${st}). The working tree may be a MIXED catalog and must not be built or shipped.\n\n${RECOVERY}`);
  }
}

function writeFileEnsured(to, data) {
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, data);
}

/**
 * Promote a staged generation into the shipped paths under the journal.
 * @param plan {
 *   journalPath, hash,
 *   artDir: {from, to} | null   mirror a directory (add/replace, delete extras)
 *   files: [{from, to}]         JSON/text files to copy in order (version token LAST)
 * }
 * @param opts { failAfter } test hook: throw after this many promote phases.
 *
 * The journal records the FULL {artDir, files} plan (from->to pairs), not just the
 * targets, so recover() can rebuild the plan from the journal + retained staging
 * ALONE - the way the orchestrator's --recover path calls it after a crash.
 */
export function promote(plan, opts = {}) {
  const { journalPath } = plan;
  const phases = [];
  if (plan.artDir) phases.push({ kind: 'art', ...plan.artDir });
  for (const f of plan.files || []) phases.push({ kind: 'file', ...f });

  writeFileEnsured(journalPath, JSON.stringify({
    status: 'in-progress',
    hash: plan.hash ?? null,
    artDir: plan.artDir ?? null,
    files: plan.files ?? [],
    startedAt: new Date().toISOString(),
  }, null, 2));

  let done = 0;
  for (const p of phases) {
    if (opts.failAfter != null && done >= opts.failAfter) throw new Error(`injected failure after ${done} promote phase(s)`);
    if (p.kind === 'art') {
      // Mirror: replace the target dir wholesale (delete files absent from staging).
      rmSync(p.to, { recursive: true, force: true });
      cpSync(p.from, p.to, { recursive: true });
    } else {
      writeFileEnsured(p.to, readFileSync(p.from));
    }
    done++;
  }
  if (opts.failAfter != null && done >= opts.failAfter) throw new Error(`injected failure after ${done} promote phase(s)`);

  writeFileSync(journalPath, JSON.stringify({ status: 'complete', hash: plan.hash ?? null, finishedAt: new Date().toISOString() }, null, 2));
  rmSync(journalPath, { force: true });
  return done;
}

/**
 * Re-run promote from ONLY the journal + retained staging on disk (recovery).
 * Reconstructs the plan from the recorded from->to pairs, so it works even in a
 * fresh process that never held the original plan object.
 */
export function recover(journalPath) {
  const j = readJournal(journalPath);
  if (!j || j.status === 'complete') return { recovered: false, reason: 'no pending promotion' };
  const plan = { journalPath, hash: j.hash ?? null, artDir: j.artDir ?? null, files: j.files ?? [] };
  const phases = promote(plan);
  return { recovered: true, phases };
}
