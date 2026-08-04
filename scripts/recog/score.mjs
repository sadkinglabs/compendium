#!/usr/bin/env node
// Gate-0 OCR baseline scorer.
// Spec: docs/proposals/card-recogniser-gate0-plan.md (§1), card-recogniser-embedding.md (§5.4.5, §8 Gate 0).
//
// Joins the governed manifest (labels/tags/splits) with per-image OCR results produced by the on-device
// OCR-replay harness, and produces the per-slice recall / false-lock table under the FROZEN statistics
// method: two-sided Wilson for recall, one-sided Wilson UPPER bound for false-lock rate (rule-of-three is
// its zero-failure special case), with the capture SESSION as the honest unit for the counts caveat. It
// then evaluates the owner-accepted Gate-0 off-ramp. Pure + deterministic (no Date/random in the core).
//
//   node scripts/recog/score.mjs      # score recog-data/ocr-results.json against data/recog/manifest.json
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// --- frozen statistics (card-recogniser-embedding.md §5.4.5) ---
// one-sided z (upper bound at confidence C) and two-sided z (interval at confidence C).
const Z1 = { 0.90: 1.2816, 0.95: 1.6449, 0.975: 1.9600, 0.99: 2.3263 };
const Z2 = { 0.90: 1.6449, 0.95: 1.9600, 0.99: 2.5758 };

export function wilsonInterval(k, n, conf = 0.95) {
  if (n === 0) return { p: null, lo: null, hi: null };
  const z = Z2[conf] ?? 1.96, p = k / n, z2 = z * z, denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export function wilsonUpperOneSided(k, n, conf = 0.95) {
  if (n === 0) return null;
  const z = Z1[conf] ?? 1.6449, p = k / n, z2 = z * z, denom = 1 + z2 / n;
  return Math.min(1, (p + z2 / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom);
}

const has = (row, tag) => (row.tags || []).includes(tag);
const offAxis = (row) => has(row, 'angle:10-25deg') || has(row, 'angle:>25deg');
const stressed = (row) => offAxis(row) || has(row, 'light:glare') || has(row, 'light:dim');

// The slices the Gate-0 off-ramp is judged on, plus generic condition slices for visibility.
const SLICES = {
  overall: () => true,
  spell: (r) => has(r, 'class:spell'),
  site: (r) => has(r, 'class:site'),
  'off-axis': offAxis,
  'sites-under-stress': (r) => has(r, 'class:site') && stressed(r),
  foil: (r) => has(r, 'foil'),
  glare: (r) => has(r, 'light:glare'),
  dim: (r) => has(r, 'light:dim'),
};

/** Classify one image: 'correct' (OCR matched the true card), 'miss' (no lock), 'wrong' (locked a
 *  DIFFERENT card - a false lock). `ocrCardId` is null when OCR produced no confident match. */
export function classify(trueCard, ocrCardId) {
  if (ocrCardId == null) return 'miss';
  return ocrCardId === trueCard ? 'correct' : 'wrong';
}

function sliceStats(rows, conf) {
  const sessions = new Set(rows.map((r) => r.sessionId));
  let correct = 0, miss = 0, wrong = 0;
  for (const r of rows) {
    if (r.outcome === 'correct') correct++;
    else if (r.outcome === 'wrong') wrong++;
    else miss++;
  }
  const n = rows.length;
  return {
    n, sessions: sessions.size, correct, miss, wrong,
    recall: wilsonInterval(correct, n, conf),                 // two-sided
    falseLockUpper: wilsonUpperOneSided(wrong, n, conf),      // one-sided upper bound
  };
}

/**
 * Score OCR results against the manifest. `config`: { confidence, offRamp } where offRamp is the
 * owner-accepted bar { overall, offAxis, sitesStress } (recall floors) with zero false locks.
 * Returns a report object; deterministic. Screens (dev-only) are excluded from the baseline.
 */
export function score({ manifest, results, config = {} }) {
  const conf = config.confidence ?? 0.95;
  const bar = config.offRamp ?? { overall: 0.90, offAxis: 0.80, sitesStress: 0.80 };
  const byId = new Map(results.map((r) => [r.imageId, r.ocrCardId ?? null]));

  const scored = [];
  let unmatched = 0;
  for (const row of manifest.rows) {
    if (row.medium !== 'physical') continue;                 // screens excluded from gating evidence
    if (!byId.has(row.imageId)) { unmatched++; continue; }   // no OCR result for this image yet
    scored.push({ ...row, outcome: classify(row.card, byId.get(row.imageId)) });
  }

  const slices = {};
  for (const [name, pred] of Object.entries(SLICES)) slices[name] = sliceStats(scored.filter(pred), conf);

  const overall = slices.overall, oa = slices['off-axis'], ss = slices['sites-under-stress'];
  const meets = (s, floor) => s.n > 0 && s.recall.p >= floor;
  // Off-ramp triggers ONLY if every bar is met AND zero false locks were observed (embeddings then
  // unjustified on reliability grounds). Empty slices cannot satisfy a bar - fail closed to "build".
  const offRampTriggered =
    overall.wrong === 0 &&
    meets(overall, bar.overall) && meets(oa, bar.offAxis) && meets(ss, bar.sitesStress);

  return {
    provenance: {
      method: 'wilson', recallSided: 'two', falseLockSided: 'one-upper', confidence: conf,
      offRampBar: bar, manifestVersion: manifest.version,
      manifestDigest: createHash('sha256').update(JSON.stringify(manifest.rows.map((r) => r.imageId).sort())).digest('hex'),
      scoredImages: scored.length, physicalUnmatched: unmatched,
    },
    slices,
    offRamp: {
      triggered: offRampTriggered,
      verdict: offRampTriggered
        ? 'OCR meets the bar - encoder not justified on reliability; owner reconsiders (embed only for board).'
        : 'OCR below the bar (or evidence incomplete) - proceed to build the encoder; Gate-0 slices set its recall bars.',
    },
  };
}

function fmtPct(x) { return x == null ? ' n/a ' : `${(x * 100).toFixed(1)}%`; }

function render(report) {
  const p = report.provenance;
  const lines = [
    `=== GATE-0 OCR BASELINE ===`,
    `method=${p.method} recall=${p.recallSided}-sided falseLock=${p.falseLockSided} conf=${p.confidence}`,
    `scored=${p.scoredImages} physical images (unmatched/no-OCR-yet=${p.physicalUnmatched}) digest=${p.manifestDigest.slice(0, 12)}`,
    `bar: overall>=${p.offRampBar.overall} off-axis>=${p.offRampBar.offAxis} sites-stress>=${p.offRampBar.sitesStress}, zero false locks`,
    `--- slice (n / sessions) : recall [95% CI]  false-lock<=upper (wrong) ---`,
  ];
  for (const [name, s] of Object.entries(report.slices)) {
    const rec = s.n ? `${fmtPct(s.recall.p)} [${fmtPct(s.recall.lo)}-${fmtPct(s.recall.hi)}]` : ' n/a ';
    lines.push(`  ${name.padEnd(20)} (${String(s.n).padStart(3)} / ${String(s.sessions).padStart(2)}) : ${rec.padEnd(24)} <=${fmtPct(s.falseLockUpper)} (${s.wrong})`);
  }
  lines.push(`--- off-ramp: ${report.offRamp.triggered ? 'TRIGGERED' : 'NOT triggered'} ---`);
  lines.push(`  ${report.offRamp.verdict}`);
  return lines.join('\n');
}

// --- CLI ---
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = resolve(process.cwd());
  const manifestPath = join(ROOT, 'data', 'recog', 'manifest.json');
  const ai = process.argv.indexOf('--results');
  const resultsPath = ai > -1 ? resolve(process.argv[ai + 1]) : join(ROOT, 'recog-data', 'ocr-results.json');
  if (!existsSync(manifestPath)) { console.error(`no manifest at ${manifestPath}`); process.exit(1); }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const results = existsSync(resultsPath) ? (JSON.parse(readFileSync(resultsPath, 'utf8')).results ?? []) : [];
  if (!results.length) console.warn(`(no OCR results at ${resultsPath} yet - run the on-device OCR-replay harness first)`);
  const report = score({ manifest, results });
  const out = render(report);
  console.log(out);
  mkdirSync(join(ROOT, 'data', 'recog'), { recursive: true });
  writeFileSync(join(ROOT, 'data', 'recog', 'gate0-baseline.json'), JSON.stringify(report, null, 2) + '\n');
}
