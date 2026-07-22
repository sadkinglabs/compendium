// Deck "Illuminated Codex" poster - implemented for the Deckbuilder
// (www/index.html _buildDeckPosterCanvas). Only the data source (Compendium's
// getDeck/getDeckCards → a deck shim with _cost/_elements/_type/_thresholds) and
// asset paths (/static → public/ via BASE) are adapted; the drawing is unchanged.
import { getDeck, getDeckCards } from './deckRepository.js';
import { slugify } from './ids.js';
import { shareImage } from '../native.js';

const BASE = import.meta.env.BASE_URL;

function _loadImg(src) {
  return new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
}

// Greedy word-wrap for the share-image title.
function wrapTitleLines(ctx, text, maxW, font, maxLines) {
  ctx.font = font;
  const ell = (s) => { let r = s; while (r.length > 1 && ctx.measureText(r + '…').width > maxW) r = r.slice(0, -1); return r + '…'; };
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['Untitled deck'];
  const lines = []; let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW) cur = test;
    else { if (cur) lines.push(cur); cur = ctx.measureText(w).width > maxW ? ell(w) : w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = ell(kept[maxLines - 1] + ' ' + lines.slice(maxLines).join(' '));
    return kept;
  }
  return lines;
}

// Build the Deckbuilder-shaped `deck` object from Compendium's store.
async function deckShim(deckId) {
  const d = await getDeck(deckId);
  const zones = await getDeckCards(deckId);
  const entry = (e) => ({ name: e.name, quantity: e.quantity, _cost: e.cost, _elements: e.elements, _type: e.type, _rarity: e.rarity, _thresholds: e.thresholds });
  return {
    name: d.name,
    avatar: d.avatar?.name || 'custom',
    spellbook: (zones.spellbook || []).map(entry),
    atlas: (zones.atlas || []).map(entry),
    collection: (zones.collection || []).map(entry),
  };
}

// ── Deckbuilder poster ──
async function _buildDeckPosterCanvas(deck) {
  const SCALE = 2, W = 990, pad = 44;
  const INK = '#0b0806', GOLD = '#dcb86f';
  const ELS = ['air', 'earth', 'fire', 'water'];
  const EL_ORDER = ['Air', 'Earth', 'Fire', 'Water', 'Multi', 'Neutral'];
  const EL_GRAD = { Air: ['#b0b8c2', '#626b76'], Earth: ['#d2974f', '#8a5e2e'], Fire: ['#f07a52', '#a8381f'], Water: ['#5fa8d4', '#2f6f9e'], Multi: ['#e8ca48', '#a8861f'], Neutral: ['#a08cc0', '#6a5a80'] };
  const EL_PIE = { Air: '#c4cdd6', Earth: '#c2864a', Fire: '#e0623f', Water: '#4aa3d4', Multi: '#e3bd45', Neutral: '#a08cc0' };
  const CAT = [['Aura', 'Auras'], ['Artifact', 'Artifacts'], ['Minion', 'Minions'], ['Magic', 'Magics']];
  const elKey = (e) => { const els = (e._elements || []).filter((v) => v && v.toLowerCase() !== 'none'); return els.length === 0 ? 'Neutral' : els.length > 1 ? 'Multi' : els[0]; };

  try { await document.fonts.ready; await Promise.all([
    "700 50px 'Cinzel'", "600 22px 'Cinzel'", "700 23px 'Cinzel'", "700 34px 'Cinzel'", "700 13px 'Cinzel'", "600 18px 'Cinzel'",
    "italic 400 16px 'EB Garamond'", "400 14px 'EB Garamond'", "italic 400 12px 'EB Garamond'",
    "600 10px 'Hanken Grotesk'", "500 11px 'Hanken Grotesk'", "700 11px 'Hanken Grotesk'", "400 13px 'Hanken Grotesk'", "500 8px 'Hanken Grotesk'",
    "400 12px 'IBM Plex Mono'", "400 13px 'IBM Plex Mono'", "400 15px 'IBM Plex Mono'",
  ].map((f) => document.fonts.load(f).catch(() => {}))); } catch (e) { /* noop */ }

  // The poster no longer draws the avatar's CARD art (Phase 2 owner decision) - that art now lives on
  // the CDN, and compositing a remote image into an exported canvas would taint it (breaking toDataURL/
  // toBlob). Only the bundled, same-origin element icons are drawn; the header is the gilt gradient.
  const icons = await Promise.all(ELS.map((k) => _loadImg(`${BASE}icons/${k}.png`)))
    .then((a) => Object.fromEntries(ELS.map((k, i) => [k, a[i]])));

  const cardMeta = {};
  for (const e of [...deck.spellbook, ...deck.atlas, ...deck.collection]) cardMeta[e.name] = { cost: e._cost, th: e._thresholds || {} };
  const sbCount = deck.spellbook.reduce((s, e) => s + e.quantity, 0);
  const atCount = deck.atlas.reduce((s, e) => s + e.quantity, 0);
  const coCount = deck.collection.reduce((s, e) => s + e.quantity, 0);

  const merge = (arr) => { const m = {}; for (const e of arr) (m[e.name] = m[e.name] || { q: 0, cost: e._cost }).q += e.quantity; return m; };
  const byType = {}; CAT.forEach(([t]) => byType[t] = []); byType.Other = [];
  for (const e of deck.spellbook) byType[(CAT.find(([t]) => (e._type || '').includes(t)) || ['Other'])[0]].push(e);
  const sbLines = [];
  for (const [t, label] of [...CAT, ['Other', 'Other']]) {
    const list = byType[t]; if (!list || !list.length) continue;
    const tot = list.reduce((s, e) => s + e.quantity, 0);
    sbLines.push({ k: 'type', t: `${label.toUpperCase()} (${tot})` });
    Object.entries(merge(list)).sort((a, b) => (a[1].cost ?? 99) - (b[1].cost ?? 99) || a[0].localeCompare(b[0]))
      .forEach(([name, v]) => sbLines.push({ k: 'card', q: v.q, t: name }));
  }
  const cardLines = (list) => Object.entries(list.reduce((a, e) => (a[e.name] = (a[e.name] || 0) + e.quantity, a), {}))
    .sort((a, b) => a[0].localeCompare(b[0])).map(([n, q]) => ({ k: 'card', q, t: n }));
  const sections = [
    { title: 'Spellbook', count: sbCount, lines: sbLines, cost: true },
    { title: 'Atlas', count: atCount, lines: cardLines(deck.atlas), cost: false },
  ];
  if (deck.collection.length) sections.push({ title: 'Collection', count: coCount, lines: cardLines(deck.collection), cost: true });

  const colGap = 26, colW = (W - pad * 2 - colGap * 2) / 3;
  const ROW_H = 23, TYPE_H = 30, HERO_H = 230, zoneHeadH = 42, sectionGap = 26;
  const hOf = (l) => l.k === 'type' ? TYPE_H : ROW_H;
  function flow3(lines) {
    const total = lines.reduce((s, l) => s + hOf(l), 0), target = total / 3;
    const cols = [[], [], []]; let ci = 0, ch = 0;
    for (const l of lines) {
      if (ci < 2 && ch >= target) { const c = cols[ci];
        if (c.length && c[c.length - 1].k !== 'card') { ci++; cols[ci].push(c.pop()); ch = hOf(cols[ci][0]); }
        else { ci++; ch = 0; } }
      cols[ci].push(l); ch += hOf(l);
    }
    return cols;
  }
  sections.forEach((sec) => { sec.cols = flow3(sec.lines); sec.colH = Math.max(0, ...sec.cols.map((c) => c.reduce((s, l) => s + hOf(l), 0))); });
  let yCursor = HERO_H + 34;
  sections.forEach((sec) => { sec.top = yCursor; yCursor += zoneHeadH + sec.colH + sectionGap; });
  const statsTop = yCursor + 18, STATS_H = 336;
  const H = statsTop + STATS_H + 52;

  const cv = document.createElement('canvas');
  cv.width = W * SCALE; cv.height = H * SCALE;
  const x = cv.getContext('2d');
  x.scale(SCALE, SCALE);
  x.textBaseline = 'alphabetic';
  const rrect = (px, py, pw, ph, r) => { r = Math.min(r, pw / 2, ph / 2); x.beginPath(); x.moveTo(px + r, py); x.cx-decksTo(px + pw, py, px + pw, py + ph, r); x.cx-decksTo(px + pw, py + ph, px, py + ph, r); x.cx-decksTo(px, py + ph, px, py, r); x.cx-decksTo(px, py, px + pw, py, r); x.closePath(); };
  const topRect = (px, py, pw, ph, r) => { r = Math.min(r, pw / 2, ph); x.beginPath(); x.moveTo(px, py + ph); x.lineTo(px, py + r); x.quadraticCurveTo(px, py, px + r, py); x.lineTo(px + pw - r, py); x.quadraticCurveTo(px + pw, py, px + pw, py + r); x.lineTo(px + pw, py + ph); x.closePath(); };
  const fit = (t, maxw) => { if (x.measureText(t).width <= maxw) return t; let s = t; while (s.length > 1 && x.measureText(s + '…').width > maxw) s = s.slice(0, -1); return s + '…'; };
  const setLS = (v) => { try { x.letterSpacing = v; } catch (e) { /* noop */ } };

  x.fillStyle = INK; x.fillRect(0, 0, W, H);
  x.save(); x.translate(W / 2, 0); x.scale(1, 0.52);
  const rg = x.createRadialGradient(0, 0, 0, 0, 0, W * 0.92);
  rg.addColorStop(0, '#1a1206'); rg.addColorStop(0.55, '#120d07'); rg.addColorStop(1, INK);
  x.fillStyle = rg; x.fillRect(-W, 0, W * 2, H * 2); x.restore();

  const hgrad = x.createLinearGradient(0, 0, 0, HERO_H);
  hgrad.addColorStop(0, 'rgba(11,8,6,.10)'); hgrad.addColorStop(0.62, 'rgba(11,8,6,.30)'); hgrad.addColorStop(1, 'rgba(11,8,6,0)');
  x.fillStyle = hgrad; x.fillRect(0, 0, W, HERO_H);

  const TITLE_FONT = "700 50px 'Cinzel', Georgia, serif", TLH = 52;
  const titleLines = wrapTitleLines(x, deck.name || 'Untitled deck', W - pad * 2, TITLE_FONT, 2);
  const subY = HERO_H - 32, titleBottom = subY - 34;
  x.save(); x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 16; x.shadowOffsetY = 2;
  x.fillStyle = '#f3ecd6'; x.font = TITLE_FONT;
  titleLines.forEach((line, i) => x.fillText(line, pad, titleBottom - (titleLines.length - 1 - i) * TLH));
  x.restore();
  const arche = deck.avatar || 'custom';
  const subText = `${/^[aeiou]/i.test(arche) ? 'An' : 'A'} ${arche} deck`;
  x.fillStyle = '#cdbf9a'; x.font = "italic 400 16px 'EB Garamond', Georgia, serif";
  const subW = x.measureText(subText).width;
  x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 8; x.fillText(subText, pad, subY); x.restore();
  const present = ELS.filter((el) => deck.spellbook.some((e) => ((e._thresholds || {})[el] || 0) > 0));
  let sigX = pad + subW + 10;
  for (const k of present) { if (icons[k]) x.drawImage(icons[k], sigX, subY - 14, 16, 16); sigX += 21; }

  sections.forEach((sec) => {
    x.fillStyle = GOLD; x.font = "600 22px 'Cinzel', Georgia, serif"; x.fillText(sec.title, pad, sec.top + 22);
    const tw = x.measureText(sec.title).width;
    x.fillStyle = '#8a8175'; x.font = "400 15px 'IBM Plex Mono', monospace"; x.fillText(`${sec.count}`, pad + tw + 12, sec.top + 21);
    x.strokeStyle = 'rgba(220,184,111,.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(pad, sec.top + zoneHeadH - 9); x.lineTo(W - pad, sec.top + zoneHeadH - 9); x.stroke();
    sec.cols.forEach((col, idx) => {
      const cx0 = pad + idx * (colW + colGap); let y = sec.top + zoneHeadH;
      for (const l of col) {
        y += hOf(l); const by = y - 7;
        if (l.k === 'type') { x.fillStyle = '#a08cc0'; x.font = "600 10px 'Hanken Grotesk', sans-serif"; setLS('0.12em'); x.fillText(l.t, cx0, by - 3); setLS('0px'); continue; }
        const m = cardMeta[l.t] || {}, th = m.th || {};
        let rx = cx0 + colW;
        if (sec.cost && m.cost != null) { x.fillStyle = '#d8cebb'; x.font = "400 13px 'IBM Plex Mono', monospace"; x.textAlign = 'right'; x.fillText(String(m.cost), rx, by); x.textAlign = 'left'; rx -= 20; }
        for (const el of ['water', 'fire', 'earth', 'air']) for (let i = 0; i < (th[el] || 0); i++) { rx -= 15; if (icons[el]) x.drawImage(icons[el], rx, by - 12, 13, 13); }
        x.fillStyle = '#8a8175'; x.font = "400 13px 'IBM Plex Mono', monospace"; x.fillText(`${l.q}×`, cx0, by);
        x.fillStyle = '#efe7d8'; x.font = "400 14px 'EB Garamond', Georgia, serif"; const nx = cx0 + 24; x.fillText(fit(l.t, rx - nx - 6), nx, by);
      }
    });
  });

  x.strokeStyle = 'rgba(220,184,111,.18)'; x.lineWidth = 1; x.beginPath(); x.moveTo(pad, statsTop - 26); x.lineTo(W - pad, statsTop - 26); x.stroke();
  const halfGap = 40, halfW = (W - pad * 2 - halfGap) / 2, leftX = pad, rightX = pad + halfW + halfGap;

  (function () {
    const px = leftX, py = statsTop, pw = halfW, ph = STATS_H;
    x.fillStyle = GOLD; x.font = "600 18px 'Cinzel', Georgia, serif"; x.fillText('Mana Curve', px, py + 6);
    const costs = {};
    for (const e of deck.spellbook) { if (e._cost == null) continue; const c = Math.min(e._cost, 10); const el = elKey(e); (costs[c] = costs[c] || {})[el] = (costs[c][el] || 0) + e.quantity; }
    const pc = Object.keys(costs).map(Number);
    if (!pc.length) { x.fillStyle = '#6b6254'; x.font = "italic 14px 'EB Garamond', Georgia, serif"; x.fillText('Add spells to see the curve.', px, py + 64); return; }
    const minC = Math.min(...pc), maxC = Math.min(Math.max(...pc), 10);
    const elements = EL_ORDER.filter((el) => Object.values(costs).some((s) => s[el]));
    const totals = {}; for (let c = minC; c <= maxC; c++) totals[c] = Object.values(costs[c] || {}).reduce((s, v) => s + v, 0);
    const maxY = Math.max(1, ...Object.values(totals));
    const peakC = Object.keys(totals).reduce((a, b) => totals[b] > totals[a] ? b : a, String(minC));
    const niceStep = (r, t) => { const raw = r / t, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; };
    const step = Math.max(1, Math.ceil(niceStep(maxY, 4))), niceMax = Math.max(1, Math.ceil(maxY / step) * step);
    const PL = px + 4, PR = px + pw - 4, PT = py + 48, PB = py + ph - 28, plotW = PR - PL, plotH = PB - PT;
    const cols = maxC - minC + 1, colW2 = plotW / cols, barW = Math.max(colW2 * 0.62, 8);
    x.save(); x.shadowColor = 'rgba(220,184,111,.55)'; x.shadowBlur = 9; x.strokeStyle = 'rgba(220,184,111,.5)'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(PL, PB); x.lineTo(PR, PB); x.stroke(); x.restore();
    const gc = {}; const grad = (el) => { if (gc[el]) return gc[el]; const [c1, c2] = EL_GRAD[el] || ['#a08cc0', '#6a5a80']; const g = x.createLinearGradient(0, PT, 0, PB); g.addColorStop(0, c1); g.addColorStop(1, c2); return gc[el] = g; };
    for (let c = minC; c <= maxC; c++) {
      const cxx = PL + (c - minC + 0.5) * colW2, bx = cxx - barW / 2; let yTop = PB;
      const topEl = [...elements].reverse().find((el) => (costs[c]?.[el] || 0) > 0), isPeak = String(c) === String(peakC) && totals[c] > 0;
      for (const el of elements) { const v = costs[c]?.[el] || 0; if (!v) continue; const h = v / niceMax * plotH, segY = yTop - h; x.fillStyle = grad(el);
        if (el === topEl) { x.save(); if (isPeak) { x.shadowColor = 'rgba(160,140,192,.55)'; x.shadowBlur = 14; } topRect(bx, segY, barW, h, Math.min(4, barW / 2, h)); x.fill(); x.restore(); }
        else { x.fillRect(bx, segY, barW, h); } yTop = segY;
      }
      if (totals[c] > 0) { x.fillStyle = isPeak ? GOLD : '#f0e9d8'; x.font = "700 13px 'Cinzel', Georgia, serif"; x.textAlign = 'center'; x.save(); if (isPeak) { x.shadowColor = 'rgba(160,140,192,.5)'; x.shadowBlur = 9; } x.fillText(totals[c], cxx, yTop - 7); x.restore(); x.textAlign = 'left'; }
      x.fillStyle = 'rgba(220,184,111,.85)'; x.font = "400 12px 'IBM Plex Mono', monospace"; x.textAlign = 'center'; x.fillText(c === 10 ? '10+' : String(c), cxx, PB + 18); x.textAlign = 'left';
    }
  })();

  (function () {
    const px = rightX, py = statsTop, pw = halfW;
    x.fillStyle = GOLD; x.font = "600 18px 'Cinzel', Georgia, serif"; x.fillText('Composition', px, py + 6);
    const bodyTop = py + 26, rowH = (STATS_H - 26 - 26) / 2, Ro = 46, Ri = 30;
    const drawDonut = (ccx, ccy, slices, total, label) => {
      x.lineWidth = Ro - Ri; const r = (Ro + Ri) / 2;
      if (total) { let ang = -Math.PI / 2; for (const s of slices) { if (!s.value) continue; const a = s.value / total * 2 * Math.PI; x.strokeStyle = s.color; x.beginPath(); x.cx-decks(ccx, ccy, r, ang, ang + a); x.stroke(); ang += a; } }
      else { x.strokeStyle = 'rgba(74,60,34,.5)'; x.beginPath(); x.cx-decks(ccx, ccy, r, 0, 7); x.stroke(); }
      x.strokeStyle = 'rgba(220,184,111,.3)'; x.lineWidth = 1; x.beginPath(); x.cx-decks(ccx, ccy, Ro, 0, 7); x.stroke();
      const ig = x.createRadialGradient(ccx, ccy - Ri * 0.4, 1, ccx, ccy, Ri); ig.addColorStop(0, '#1a1206'); ig.addColorStop(1, '#0b0806');
      x.fillStyle = ig; x.beginPath(); x.cx-decks(ccx, ccy, Ri, 0, 7); x.fill();
      x.fillStyle = '#f0e9d8'; x.font = "700 22px 'Cinzel', Georgia, serif"; x.textAlign = 'center'; x.fillText(total, ccx, ccy + 1);
      x.fillStyle = '#8a8175'; x.font = "600 7.5px 'Hanken Grotesk', sans-serif"; setLS('0.05em'); x.fillText(label, ccx, ccy + 14); setLS('0px'); x.textAlign = 'left';
    };
    const sbData = EL_ORDER.map((k) => { let v = 0; for (const e of deck.spellbook) if (elKey(e) === k) v += e.quantity; return { label: k, value: v, color: EL_PIE[k] }; });
    drawDonut(px + Ro + 2, bodyTop + rowH * 0.46, sbData, sbCount, 'SPELLBOOK');
    const barsX = px + Ro * 2 + 22, barsW = px + pw - barsX, blockH = (rowH - 10) / 4;
    CAT.forEach(([t, label], i) => {
      const counts = {}; let tot = 0; for (const e of deck.spellbook) { if (!(e._type || '').includes(t)) continue; const k = elKey(e); counts[k] = (counts[k] || 0) + e.quantity; tot += e.quantity; }
      const ry = bodyTop + 4 + i * blockH;
      x.fillStyle = '#d8cebb'; x.font = "500 11px 'Hanken Grotesk', sans-serif"; x.fillText(label, barsX, ry + 9);
      x.fillStyle = '#8a8175'; x.font = "400 11px 'IBM Plex Mono', monospace"; x.textAlign = 'right'; x.fillText(String(tot), px + pw, ry + 9); x.textAlign = 'left';
      const tY = ry + 14, tH = 7; x.fillStyle = 'rgba(42,33,20,.5)'; rrect(barsX, tY, barsW, tH, 3.5); x.fill();
      if (tot) { x.save(); rrect(barsX, tY, barsW, tH, 3.5); x.clip(); let sxp = barsX; EL_ORDER.filter((k) => counts[k]).forEach((k) => { const sw = barsW * counts[k] / tot; x.fillStyle = EL_PIE[k]; x.fillRect(sxp, tY, sw + 0.5, tH); sxp += sw; }); x.restore(); }
    });
    const aTop = bodyTop + rowH;
    const atData = EL_ORDER.map((k) => { let v = 0; for (const e of deck.atlas) if (elKey(e) === k) v += e.quantity; return { label: k, value: v, color: EL_PIE[k] }; });
    drawDonut(px + Ro + 2, aTop + rowH * 0.46, atData, atCount, 'ATLAS');
    const infoX = px + Ro * 2 + 22;
    let cs = 0, cn = 0; for (const e of deck.spellbook) if (e._cost != null) { cs += e._cost * e.quantity; cn += e.quantity; } const avg = cn ? (cs / cn).toFixed(1) : '0.0';
    x.font = "700 34px 'Cinzel', Georgia, serif"; const avgW = x.measureText(avg).width;
    x.save(); x.shadowColor = 'rgba(220,184,111,.35)'; x.shadowBlur = 14; x.fillStyle = GOLD; x.fillText(avg, infoX, aTop + 30); x.restore();
    x.fillStyle = '#8a8175'; x.font = "italic 12px 'EB Garamond', Georgia, serif"; x.fillText('avg spell cost', infoX + avgW + 12, aTop + 27);
    const peak = {}, sup = {}; ELS.forEach((k) => { peak[k] = 0; sup[k] = 0; });
    for (const e of deck.spellbook) { const t = e._thresholds || {}; for (const k of ELS) peak[k] = Math.max(peak[k], t[k] || 0); }
    for (const e of deck.atlas) { const t = e._thresholds || {}; for (const k of ELS) if ((t[k] || 0) > 0) sup[k] += e.quantity; }
    const needs = ELS.filter((k) => peak[k] > 0); let ny = aTop + 52;
    if (!needs.length) { x.fillStyle = '#6b6254'; x.font = "italic 12px 'EB Garamond', Georgia, serif"; x.fillText('No thresholds required', infoX, ny); }
    needs.forEach((k) => { if (icons[k]) x.drawImage(icons[k], infoX, ny - 11, 14, 14);
      x.fillStyle = '#8a8175'; x.font = "400 12px 'Hanken Grotesk', sans-serif"; x.fillText(`need ${peak[k]} · ${sup[k]} sites`, infoX + 20, ny);
      const ok = sup[k] >= peak[k] * 2, tight = sup[k] > 0 && !ok, col = sup[k] === 0 ? '#e0623f' : tight ? '#e0c074' : '#8fd3a8', txt = sup[k] === 0 ? 'none' : tight ? 'tight' : 'ok';
      x.fillStyle = col; x.font = "700 11px 'Hanken Grotesk', sans-serif"; x.textAlign = 'right'; x.fillText(txt, px + pw, ny); x.textAlign = 'left'; ny += 20; });
    const leg = EL_ORDER.filter((k) => [...deck.spellbook, ...deck.atlas].some((e) => elKey(e) === k));
    let lx = px, ly = py + STATS_H; x.font = "400 11px 'Hanken Grotesk', sans-serif";
    leg.forEach((k) => { x.fillStyle = EL_PIE[k]; rrect(lx, ly - 9, 10, 10, 3); x.fill(); x.fillStyle = '#8a8175'; x.fillText(k, lx + 15, ly); lx += 15 + x.measureText(k).width + 14; });
  })();

  x.fillStyle = 'rgba(220,184,111,.5)'; x.font = "400 13px 'Hanken Grotesk', sans-serif"; x.fillText('Built with Compendium', pad, H - 22);
  return cv;
}

/** Build + share the deck poster for a Compendium deck. */
export async function shareDeckPoster(deckId) {
  const deck = await deckShim(deckId);
  const cv = await _buildDeckPosterCanvas(deck);
  return shareImage(cv, `${slugify(deck.name || 'deck')}.png`, deck.name || 'Deck');
}
