// Deck statistics — ported faithfully from Arcanum (www/index.html). The
// algorithms are verbatim; only the palette is mapped to Compendium's element
// tokens. Pure functions over the {spellbook, atlas, collection} shape from
// deckRepository.getDeckCards (entries carry cost/attack/type/rarity/elements/thresholds).

// element-data colours (Compendium tokens) + Multi=gold, Neutral=link-violet
export const EL_CHART = { Air: '#67b6c4', Earth: '#b6924a', Fire: '#d2645a', Water: '#5b87d6', Multi: '#dcb86f', Neutral: '#c79ad0' };
export const EL_GRAD = {
  Air: ['#67b6c4', '#2f6f7a'], Earth: ['#b6924a', '#6e5526'], Fire: ['#d2645a', '#7a2a22'],
  Water: ['#5b87d6', '#2f4f8a'], Multi: ['#dcb86f', '#8c6a2a'], Neutral: ['#c79ad0', '#6a4a78'],
};
export const RAR_CHART = { Ordinary: '#8a8298', Exceptional: '#5b87d6', Elite: '#dcb86f', Unique: '#c79ad0' };
const EL_ORDER = ['Air', 'Earth', 'Fire', 'Water', 'Multi', 'Neutral'];
const RAR_ORDER = ['Ordinary', 'Exceptional', 'Elite', 'Unique'];

// one bucket per card: 0 elements → Neutral, >1 → Multi, else the element (verbatim)
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
    if (!typeIs(e, 'Minion') || e.attack == null) continue;
    const p = Math.min(e.attack, 10), el = elemKey(e);
    (powers[p] || (powers[p] = {}))[el] = (powers[p][el] || 0) + e.quantity;
  }
  return powers;
}

/** Verbatim port of Arcanum buildManaCurveSVG → returns an SVG string. */
export function curveSVG(costs, { num = 'rgba(220,184,111,.92)', border = 'rgba(220,184,111,.38)', label = 'mana', peakGlow = 'rgba(220,184,111,.55)' } = {}) {
  const present = Object.keys(costs).map(Number);
  if (!present.length) return '';
  const maxCost = Math.min(Math.max(...present), 10), minCost = Math.min(...present);
  const elements = EL_ORDER.filter((el) => Object.values(costs).some((slot) => slot[el]));
  const W = 320, H = 148, PL = 8, PB = 36, PT = 22, PR = 8;
  const plotW = W - PL - PR, plotH = H - PT - PB;
  const cols = maxCost - minCost + 1, colW = plotW / cols, barW = Math.max(colW * 0.68, 5);
  const totals = {};
  for (let c = minCost; c <= maxCost; c++) totals[c] = Object.values(costs[c] || {}).reduce((s, v) => s + v, 0);
  const maxY = Math.max(1, ...Object.values(totals));
  const peakCost = Object.entries(totals).reduce((a, b) => (totals[b[0]] > totals[a[0]] ? b : a), ['0', 0])[0];
  const niceStep = (r, t) => { const raw = r / t, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
  const step = Math.max(1, Math.ceil(niceStep(maxY, 4)));
  const niceMax = Math.max(1, Math.ceil(maxY / step) * step);
  const yOf = (v) => PT + plotH - (v / niceMax) * plotH;
  const baselineY = yOf(0);
  const gradDefs = elements.map((el) => { const [c1, c2] = EL_GRAD[el] || ['#9a90ac', '#5c5470']; return `<linearGradient id="elg-${el}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient>`; }).join('');
  const baseline = `<line x1="${PL}" y1="${baselineY.toFixed(1)}" x2="${W - PR}" y2="${baselineY.toFixed(1)}" stroke="rgba(220,184,111,.4)" stroke-width="1.2"/>`;
  const bars = [];
  for (let c = minCost; c <= maxCost; c++) {
    const cx = PL + (c - minCost + 0.5) * colW, x = cx - barW / 2;
    const isPeak = String(c) === String(peakCost) && totals[c] > 0;
    let yTop = baselineY;
    const topEl = [...elements].reverse().find((el) => (costs[c]?.[el] || 0) > 0);
    for (const el of elements) {
      const v = costs[c]?.[el] || 0; if (!v) continue;
      const h = (v / niceMax) * plotH, segY = yTop - h, fill = `url(#elg-${el})`;
      if (el === topEl) {
        const r = Math.min(4, barW / 2, h), glow = isPeak ? ' filter="url(#peak-glow)"' : '';
        bars.push(`<path d="M${x.toFixed(1)},${(segY + h).toFixed(1)} L${x.toFixed(1)},${(segY + r).toFixed(1)} Q${x.toFixed(1)},${segY.toFixed(1)} ${(x + r).toFixed(1)},${segY.toFixed(1)} L${(x + barW - r).toFixed(1)},${segY.toFixed(1)} Q${(x + barW).toFixed(1)},${segY.toFixed(1)} ${(x + barW).toFixed(1)},${(segY + r).toFixed(1)} L${(x + barW).toFixed(1)},${(segY + h).toFixed(1)} Z" fill="${fill}"${glow}/>`);
      } else {
        bars.push(`<rect x="${x.toFixed(1)}" y="${segY.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}"/>`);
      }
      yTop = segY;
    }
    if (totals[c] > 0) bars.push(`<text x="${cx.toFixed(1)}" y="${(yTop - 4).toFixed(1)}" text-anchor="middle" fill="rgba(240,233,216,.85)" font-size="9" font-weight="700">${totals[c]}</text>`);
    const badgeCY = H - PB / 2, badgeR = Math.min(colW * 0.44, 9);
    bars.push(`<circle cx="${cx.toFixed(1)}" cy="${badgeCY.toFixed(1)}" r="${badgeR.toFixed(1)}" fill="rgba(14,8,26,.92)" stroke="${border}" stroke-width="1"/>`);
    bars.push(`<text x="${cx.toFixed(1)}" y="${(badgeCY + 3.5).toFixed(1)}" text-anchor="middle" fill="${num}" font-size="8.5" font-weight="700">${c === 10 ? '10+' : c}</text>`);
  }
  bars.push(`<text x="1" y="${(H - PB / 2 + 3).toFixed(1)}" text-anchor="start" fill="${num}" fill-opacity="0.6" font-size="7.5" font-style="italic">${label}</text>`);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="overflow:hidden;display:block"><defs>${gradDefs}<filter id="peak-glow" x="-60%" y="-60%" width="220%" height="220%"><feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="${peakGlow}" flood-opacity="1"/></filter></defs>${baseline}${bars.join('')}</svg>`;
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
export function supplyData(spellbook, atlas) {
  const peak = peakThresholds(spellbook), sup = { air: 0, earth: 0, fire: 0, water: 0 };
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

// Verbatim Monte-Carlo: P(control ≥ peak threshold of each element after drawing
// the first `byTurn` sites). Partial Fisher-Yates over quantity-expanded atlas.
export function atlasOdds(spellbook, atlas, byTurn, sims = 10000) {
  const peak = peakThresholds(spellbook);
  const sites = [];
  for (const e of atlas) { const t = e.thresholds || {}; const th = [t.air || 0, t.earth || 0, t.fire || 0, t.water || 0]; const q = Math.max(0, Math.min(e.quantity | 0, 99)); for (let i = 0; i < q; i++) sites.push(th); }
  const N = sites.length;
  const need = ELS.filter((k) => peak[k] > 0);
  const prob = { air: 0, earth: 0, fire: 0, water: 0 };
  if (!N || !need.length) return { peak, prob, joint: need.length ? 0 : 1, need, N, draw: 0 };
  const draw = Math.min(byTurn, N), order = sites.map((_, i) => i);
  let hitA = 0, hitE = 0, hitF = 0, hitW = 0, hitAll = 0;
  for (let s = 0; s < sims; s++) {
    let a = 0, e = 0, f = 0, w = 0;
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
