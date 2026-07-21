// Circular-import gate for src/**.
//
// WHY THIS EXISTS. A cycle between GothicSheet.jsx and ui.jsx sat latent in this repo for a
// long time. It became fatal only when an unrelated Collection import shifted Vite's chunking:
// the minified release build then initialised the two modules in an order that left a binding
// in its temporal dead zone, and the whole app rendered nothing with "Cannot access 'X' before
// initialization". The unminified build was fine. Every gate was green - test:codex,
// test:query, test:ui, test:app, check:types, check:docs AND `npm run build`. Only installing
// the signed release APK on a device found it.
//
// A cycle is not always fatal, which is exactly the danger: it is a live grenade whose pin is
// pulled by an unrelated import somewhere else. So this gate fails on ANY cycle rather than
// trying to judge which ones are currently harmless.
//
// Scope: static `import`/`export ... from` between relative paths inside src/. Those are the
// edges that determine module initialisation order. Dynamic `import()` is deliberately NOT an
// edge - it defers evaluation, which is how lazy routes legitimately point back at shared code.
//
// Run: npm run check:cycles
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

// Matches `import ... from 'x'`, `import 'x'`, and `export ... from 'x'` - all of which force
// the target to evaluate first. Bare `import('x')` (dynamic) has a paren before the quote and
// is not matched.
const EDGE = /^\s*(?:import|export)\s+(?:[^'"]*?from\s+)?['"](\.[^'"]+)['"]/gm;

const isSource = (f) => /\.(js|jsx|mjs)$/.test(f) && !f.includes('.test.');

export function listSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(full, out);
    else if (isSource(entry.name)) out.push(full);
  }
  return out;
}

/** Resolve a relative specifier the way the bundler does: exact, then .js, then .jsx. */
export function resolveSpecifier(fromFile, spec, exists = fs.existsSync) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const ext of ['', '.js', '.jsx', '.mjs']) {
    if (exists(base + ext)) return base + ext;
  }
  return null;
}

export function buildGraph(files, read = (f) => fs.readFileSync(f, 'utf8')) {
  // Resolve against the SCANNED SET rather than the filesystem. Only edges between modules we
  // are analysing can form a cycle we care about, and it keeps this function pure enough to
  // test against an in-memory file map instead of fixture files on disk.
  const known = new Set(files);
  const graph = new Map();
  for (const file of files) {
    const deps = [];
    for (const m of read(file).matchAll(EDGE)) {
      const target = resolveSpecifier(file, m[1], (p) => known.has(p));
      if (target) deps.push(target);
    }
    graph.set(file, deps);
  }
  return graph;
}

/**
 * Every strongly connected component of size > 1, plus any self-import. Tarjan, iterative so a
 * deep graph cannot blow the stack.
 *
 * A naive DFS with a single global "visited" set finds only the first cycle reachable and
 * silently misses the rest - the first version of this check did exactly that and reported a
 * clean graph while a second cycle was still live. SCC finds all of them.
 */
export function findCycles(graph) {
  const index = new Map(), low = new Map(), onStack = new Set();
  const stack = [];
  const out = [];
  let counter = 0;

  for (const root of graph.keys()) {
    if (index.has(root)) continue;
    const work = [[root, 0]];
    while (work.length) {
      const frame = work[work.length - 1];
      const [node, childIdx] = frame;
      if (childIdx === 0) {
        index.set(node, counter); low.set(node, counter); counter += 1;
        stack.push(node); onStack.add(node);
      }
      const deps = graph.get(node) || [];
      let descended = false;
      for (let i = childIdx; i < deps.length; i += 1) {
        const dep = deps[i];
        if (!graph.has(dep)) continue;
        if (!index.has(dep)) {
          frame[1] = i + 1;
          work.push([dep, 0]);
          descended = true;
          break;
        } else if (onStack.has(dep)) {
          low.set(node, Math.min(low.get(node), index.get(dep)));
        }
      }
      if (descended) continue;

      if (low.get(node) === index.get(node)) {
        const comp = [];
        for (;;) {
          const w = stack.pop();
          onStack.delete(w);
          comp.push(w);
          if (w === node) break;
        }
        if (comp.length > 1 || (graph.get(node) || []).includes(node)) out.push(comp);
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(node)));
      }
    }
  }
  return out;
}

/** Human-facing report. Names the edges INSIDE each cycle, so the fix is obvious. */
export function formatCycles(cycles, graph, root = ROOT) {
  const rel = (p) => path.relative(root, p).split(path.sep).join('/');
  const lines = [];
  for (const comp of cycles) {
    const members = new Set(comp);
    lines.push('  circular imports:');
    for (const m of [...comp].sort()) {
      const inside = (graph.get(m) || []).filter((d) => members.has(d)).map(rel).sort();
      lines.push(`    ${rel(m)} -> ${inside.join(', ')}`);
    }
  }
  return lines.join('\n');
}

export function run({ files = null, read } = {}) {
  const list = files || listSourceFiles(SRC);
  if (!list.length) {
    // Fail closed: an empty scan means the walker is broken, not that the code is clean.
    console.error('check:cycles FAILED - no source files found under src/');
    return 1;
  }
  const graph = buildGraph(list, read);
  const cycles = findCycles(graph);
  if (cycles.length) {
    console.error(`check:cycles FAILED - ${cycles.length} circular import group(s) in src/\n`);
    console.error(formatCycles(cycles, graph));
    console.error('\nA cycle can look harmless for months and then blank the app when chunking');
    console.error('shifts. Break it by moving the shared piece into a leaf module that imports');
    console.error('nothing from either side (see src/components/useFocusTrap.js).');
    return 1;
  }
  console.log(`check:cycles OK - ${list.length} modules, no circular imports`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(run());
}
