// Deck statistics - Deck analysis algorithms for mana, power, composition, thresholds, and draw odds. The
// The algorithms share Compendium's element palette and catalogue shapes.
// tokens. Pure functions over the {spellbook, atlas, collection} shape from
// deckRepository.getDeckCards (entries carry cost/attack/type/rarity/elements/thresholds).

// Element + rarity chart colours - the app-wide language (mirror the tokens in
// tokens.css): Air grey, Earth brown, Fire red, Water blue, Multi gold; rarity
// = Ordinary silver, Exceptional blue, Elite purple, Unique gold (the same hues
// the "Show Rarity Colours" toggle paints card names with).
export const EL_CHART = { Air: '#c4cdd6', Earth: '#b35c33', Fire: '#e0623f', Water: '#4aa3d4', Multi: '#d4a83a', Neutral: '#a08cc0' };
export const EL_GRAD = {
  Air: ['#c4cdd6', '#5f6b76'], Earth: ['#b35c33', '#5f2e1a'], Fire: ['#e0623f', '#7a2a1c'],
  Water: ['#4aa3d4', '#255777'], Multi: ['#d4a83a', '#7a5e1e'], Neutral: ['#a08cc0', '#6a5a80'],
};
export const RAR_CHART = { Ordinary: '#c8c8c8', Exceptional: '#4fc3f7', Elite: '#ab47bc', Unique: '#ffd54f' };
export const EL_ORDER = ['Air', 'Earth', 'Fire', 'Water', 'Multi', 'Neutral'];
const RAR_ORDER = ['Ordinary', 'Exceptional', 'Elite', 'Unique'];

// One bucket per card: 0 elements → Neutral, >1 → Multi, otherwise the element.
export function elemKey(e) {
  const els = (e.elements || []).filter((x) => x && x.toLowerCase() !== 'none');
  return els.length === 0 ? 'Neutral' : els.length > 1 ? 'Multi' : els[0];
}

const typeIs = (e, t) => (e.type || '').includes(t);

/* ---------------- mana / power curve (element-stacked) ---------------- */

export function manaCurveData(spellbook) {
  const costs = {};
  for (const e of spellbook) {
    if (e.cost == null) continue;
    const c = Math.min(e.cost, 10), el = elemKey(e);
    (costs[c] || (costs[c] = {}))[el] = (costs[c][el] || 0) + e.quantity;
  }
  return costs;
}
export function powerCurveData(spellbook) {
  const powers = {};
  for (const e of spellbook) {
    // Minions AND automatons (Artifact / Automaton) have power. Within the
    // spellbook only those two carry an attack value - sites (which also attack)
    // live in the atlas - so `attack != null` is exactly "minions and automatons".
    if (e.attack == null) continue;
    const p = Math.min(e.attack, 10), el = elemKey(e);
    (powers[p] || (powers[p] = {}))[el] = (powers[p][el] || 0) + e.quantity;
  }
  return powers;
}

/** Layout data for the HTML/CSS mana & power curves (element-stacked). Same math
 *  as the old SVG builder: nice-rounded y-axis, per-column element segments, and
 *  the peak column flagged. The view renders the bars/labels so typography is exact. */
export function curveBars(costs) {
  const present = Object.keys(costs).map(Number);
  if (!present.length) return null;
  const maxCost = Math.min(Math.max(...present), 10), minCost = Math.min(...present);
  const elements = EL_ORDER.filter((el) => Object.values(costs).some((slot) => slot[el]));
  const totals = {};
  for (let c = minCost; c <= maxCost; c++) totals[c] = Object.values(costs[c] || {}).reduce((s, v) => s + v, 0);
  const maxY = Math.max(1, ...Object.values(totals));
  let peakCost = minCost;
  for (let c = minCost; c <= maxCost; c++) if (totals[c] > totals[peakCost]) peakCost = c;
  const niceStep = (r, t) => { const raw = r / t, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
  const step = Math.max(1, Math.ceil(niceStep(maxY, 4)));
  const niceMax = Math.max(1, Math.ceil(maxY / step) * step);
  const cols = [];
  for (let c = minCost; c <= maxCost; c++) {
    const slot = costs[c] || {};
    const segs = elements.filter((el) => slot[el]).map((el) => ({ el, grad: EL_GRAD[el] || ['#9a90ac', '#5c5470'], frac: slot[el] / niceMax }));
    cols.push({ cost: c, label: c === 10 ? '10+' : String(c), total: totals[c], isPeak: c === peakCost && totals[c] > 0, segs });
  }
  return { cols, niceMax };
}

export const curveLegend = (costs) => EL_ORDER.filter((el) => Object.values(costs).some((s) => s[el])).map((el) => ({ el, color: EL_CHART[el] }));

/* ---------------- composition (donut + type bars) ---------------- */

export function compositionData(entries, mode) {
  const counts = {};
  for (const e of entries) { const key = mode === 'element' ? elemKey(e) : (e.rarity || 'Unknown'); counts[key] = (counts[key] || 0) + e.quantity; }
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 0;
  const order = mode === 'element' ? EL_ORDER : RAR_ORDER;
  const colorOf = (k) => mode === 'element' ? (EL_CHART[k] || '#777') : (RAR_CHART[k] || '#777');
  const keys = Object.keys(counts).sort((a, b) => { const ai = order.indexOf(a), bi = order.indexOf(b); return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b); });
  return { total, slices: keys.map((k) => ({ label: k, value: counts[k], pct: total ? counts[k] / total : 0, color: colorOf(k) })) };
}

export function typeBars(spellbook, mode) {
  const TYPES = [['Aura', 'Auras'], ['Artifact', 'Artifacts'], ['Minion', 'Minions'], ['Magic', 'Magics']];
  const order = mode === 'rarity' ? RAR_ORDER : EL_ORDER;
  const colorMap = mode === 'rarity' ? RAR_CHART : EL_CHART;
  return TYPES.map(([t, label]) => {
    const counts = {}; let typeTotal = 0;
    for (const e of spellbook) { if (!typeIs(e, t)) continue; const key = mode === 'rarity' ? (e.rarity || 'Ordinary') : elemKey(e); counts[key] = (counts[key] || 0) + e.quantity; typeTotal += e.quantity; }
    if (!typeTotal) return null;
    const segs = order.filter((k) => counts[k]).map((k) => ({ pct: counts[k] / typeTotal * 100, color: colorMap[k] }));
    return { label, total: typeTotal, segs };
  }).filter(Boolean);
}

export function conicGradient(slices) {
  if (!slices.length) return 'conic-gradient(rgba(40,28,20,.6) 0deg 360deg)';
  let deg = 0;
  return 'conic-gradient(' + slices.map((s) => { const span = s.pct * 360; const r = `${s.color} ${deg.toFixed(1)}deg ${(deg + span).toFixed(1)}deg`; deg += span; return r; }).join(',') + ')';
}

/* ---------------- atlas: supply + Monte-Carlo odds ---------------- */

const ELS = ['air', 'earth', 'fire', 'water'];

export function peakThresholds(spellbook) {
  const peak = { air: 0, earth: 0, fire: 0, water: 0 };
  for (const e of spellbook) { const t = e.thresholds || {}; for (const k of ELS) peak[k] = Math.max(peak[k], t[k] || 0); }
  return peak;
}
export function supplyData(spellbook, atlas, base = 0) {
  // `base` = element control present from turn 0 regardless of atlas (Elementalist = 1 of each).
  const peak = peakThresholds(spellbook), sup = { air: base, earth: base, fire: base, water: base };
  for (const e of atlas) { const t = e.thresholds || {}; for (const k of ELS) if ((t[k] || 0) > 0) sup[k] += e.quantity; }
  return ELS.filter((k) => peak[k] > 0).map((k) => {
    const ok = sup[k] >= peak[k] * 2, tight = sup[k] > 0 && !ok;
    return { el: k, peak: peak[k], supply: sup[k], status: sup[k] === 0 ? 'none' : tight ? 'tight' : 'ok' };
  });
}
export function avgCost(spellbook) {
  let cs = 0, cn = 0;
  for (const e of spellbook) if (e.cost != null) { cs += e.cost * e.quantity; cn += e.quantity; }
  return cn ? (cs / cn).toFixed(1) : '0.0';
}

// Monte-Carlo: P(control ≥ peak threshold of each element after drawing
// the first `byTurn` sites). Partial Fisher-Yates over quantity-expanded atlas.
export function atlasOdds(spellbook, atlas, byTurn, sims = 10000, base = 0) {
  const peak = peakThresholds(spellbook);
  const sites = [];
  for (const e of atlas) { const t = e.thresholds || {}; const th = [t.air || 0, t.earth || 0, t.fire || 0, t.water || 0]; const q = Math.max(0, Math.min(e.quantity | 0, 99)); for (let i = 0; i < q; i++) sites.push(th); }
  const N = sites.length;
  const need = ELS.filter((k) => peak[k] > 0);
  const prob = { air: 0, earth: 0, fire: 0, water: 0 };
  if (!N || !need.length) {
    // No atlas draws to simulate: only the starting `base` control can satisfy a peak.
    for (const k of ELS) prob[k] = peak[k] > 0 && base >= peak[k] ? 1 : 0;
    const joint = need.length ? (need.every((k) => base >= peak[k]) ? 1 : 0) : 1;
    return { peak, prob, joint, need, N, draw: 0 };
  }
  const draw = Math.min(byTurn, N), order = sites.map((_, i) => i);
  let hitA = 0, hitE = 0, hitF = 0, hitW = 0, hitAll = 0;
  for (let s = 0; s < sims; s++) {
    let a = base, e = base, f = base, w = base;   // Elementalist etc. start with +base of each
    for (let i = 0; i < draw; i++) { const j = i + Math.floor(Math.random() * (N - i)); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; const th = sites[order[i]]; a += th[0]; e += th[1]; f += th[2]; w += th[3]; }
    const okA = peak.air === 0 || a >= peak.air, okE = peak.earth === 0 || e >= peak.earth, okF = peak.fire === 0 || f >= peak.fire, okW = peak.water === 0 || w >= peak.water;
    if (peak.air > 0 && okA) hitA++; if (peak.earth > 0 && okE) hitE++; if (peak.fire > 0 && okF) hitF++; if (peak.water > 0 && okW) hitW++;
    if (okA && okE && okF && okW) hitAll++;
  }
  prob.air = hitA / sims; prob.earth = hitE / sims; prob.fire = hitF / sims; prob.water = hitW / sims;
  return { peak, prob, joint: hitAll / sims, need, N, draw };
}

/* ---------------- spellbook odds ---------------- */

export function spellbookOdds(spellbook) {
  const TYPES = [['Aura', 'Auras'], ['Artifact', 'Artifacts'], ['Minion', 'Minions'], ['Magic', 'Magics']];
  const S = spellbook.reduce((s, e) => s + e.quantity, 0), counts = {};
  for (const e of spellbook) { const t = TYPES.find(([k]) => typeIs(e, k)); if (t) counts[t[1]] = (counts[t[1]] || 0) + e.quantity; }
  return { total: S, rows: TYPES.filter(([, l]) => counts[l]).map(([, l]) => ({ label: l, count: counts[l], pct: S ? Math.round(counts[l] / S * 100) : 0 })) };
}
