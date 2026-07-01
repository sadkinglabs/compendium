// Match "Diagonal Duel" snapshot — ported VERBATIM from Vitarum
// (www/index.html _renderMatchSnapshot). Only avatar-image lookup (AVATARS/IMG_BASE
// → catalog avatar cards) and the match-object shape are adapted.
import { getMatch } from './playRepository.js';
import { query } from './db.js';
import { shareImage } from '../native.js';
import { slugify } from './ids.js';

const BASE = import.meta.env.BASE_URL;

function _loadImg(src) { return new Promise((res) => { if (!src) return res(null); const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; }); }
function _drawCover(ctx, img, dx, dy, dw, dh, fx, fy, zoom) {
  zoom = zoom || 1;
  const ir = img.width / img.height, dr = dw / dh;
  let sw, sh;
  if (ir > dr) { sh = img.height; sw = sh * dr; } else { sw = img.width; sh = sw / dr; }
  sw /= zoom; sh /= zoom;
  const sx = (img.width - sw) * fx, sy = (img.height - sh) * fy;
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}
function _fitFont(ctx, text, tmpl, maxW, start, min) { let fs = start; do { ctx.font = tmpl.replace('$', fs); if (ctx.measureText(text).width <= maxW) break; fs -= 2; } while (fs > min); return fs; }
function _clipText(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function _fmtFullDate(iso) { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); }
function _localTimeStr(dl) { const d = new Date(dl); if (isNaN(d)) return ''; return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function _fmtDur(secs) { if (!secs) return ''; if (secs < 60) return secs + 's'; const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; }
function lifeText(val, lost) { return val > 0 ? String(val) : (lost ? '0' : 'DD'); }

async function avatarSlug(name) { if (!name) return null; const r = (await query('SELECT image_slug FROM cards WHERE name=? AND is_avatar=1 LIMIT 1;', [name]))[0]; return r?.image_slug || null; }

async function _renderMatchSnapshot(match, opts) {
  const W = 1080, H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const GOLD = '#dcb86f', GOLD_HI = '#f3e1ad', CREAM = '#e9e2cf', AETHER = '#a294c8';
  const pad = 70;
  const track = (px) => { try { ctx.letterSpacing = px + 'px'; } catch (e) { /* noop */ } };

  try { await document.fonts.ready; await Promise.all([
    'bold 156px Cinzel', '600 46px Cinzel', 'bold 168px Cinzel', 'bold 92px Cinzel',
    "600 27px 'Hanken Grotesk'", "italic 31px 'EB Garamond'",
  ].map((f) => document.fonts.load(f).catch(() => {}))); } catch (e) { /* noop */ }

  const pWin = match.winner === 'player', eWin = match.winner === 'enemy', draw = match.winner === 'draw';
  const pName = String(opts.playerName || match.profile || match.playerAvatar || 'Player 1');
  const eName = String(opts.opponentName || match.opponent || match.enemyAvatar || 'Player 2');

  const topX = W * 0.545, botX = W * 0.455;
  const seamX = (t) => topX + (botX - topX) * t;
  const poly = (pts) => { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); };
  const leftPoly = [[0, 0], [topX, 0], [botX, H], [0, H]];
  const rightPoly = [[topX, 0], [W, 0], [W, H], [botX, H]];

  const [pSlug, eSlug] = await Promise.all([avatarSlug(match.playerAvatar), avatarSlug(match.enemyAvatar)]);
  const [pImg, eImg] = await Promise.all([_loadImg(pSlug ? `${BASE}cards/${pSlug}` : ''), _loadImg(eSlug ? `${BASE}cards/${eSlug}` : '')]);
  const hasFilter = (typeof ctx.filter === 'string');
  function drawSide(img, clip, win, dx, dw) {
    ctx.save();
    poly(clip); ctx.clip();
    ctx.fillStyle = win || draw ? '#16241b' : '#161427'; ctx.fillRect(0, 0, W, H);
    if (img) {
      if (hasFilter) ctx.filter = (win || draw) ? 'saturate(1.1) brightness(1.05)' : 'saturate(0.4) brightness(0.62)';
      _drawCover(ctx, img, dx, 0, dw, H, 0.5, 0.20, 1.8);
      if (hasFilter) ctx.filter = 'none';
    }
    if (win && !draw) { ctx.fillStyle = 'rgba(220,184,111,0.13)'; ctx.fillRect(0, 0, W, H); }
    else if (!win && !draw) { ctx.fillStyle = 'rgba(42,34,70,0.42)'; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }
  drawSide(pImg, leftPoly, pWin, 0, W * 0.57);
  drawSide(eImg, rightPoly, eWin, W * 0.43, W * 0.57);

  let g = ctx.createLinearGradient(0, 0, 0, H * 0.33);
  g.addColorStop(0, 'rgba(6,11,9,0.9)'); g.addColorStop(0.62, 'rgba(6,11,9,0.55)'); g.addColorStop(1, 'rgba(6,11,9,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H * 0.33);
  g = ctx.createLinearGradient(0, H * 0.46, 0, H);
  g.addColorStop(0, 'rgba(6,11,9,0)'); g.addColorStop(0.5, 'rgba(6,11,9,0.72)'); g.addColorStop(1, 'rgba(6,11,9,0.95)');
  ctx.fillStyle = g; ctx.fillRect(0, H * 0.46, W, H * 0.54);

  const seamGrad = ctx.createLinearGradient(topX, 0, botX, H);
  seamGrad.addColorStop(0, 'rgba(220,184,111,0.25)'); seamGrad.addColorStop(0.5, 'rgba(243,225,173,0.95)'); seamGrad.addColorStop(1, 'rgba(220,184,111,0.25)');
  ctx.save();
  ctx.shadowColor = 'rgba(220,184,111,0.8)'; ctx.shadowBlur = 34;
  ctx.strokeStyle = seamGrad; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(topX, 0); ctx.lineTo(botX, H); ctx.stroke();
  ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,247,225,0.9)';
  ctx.beginPath(); ctx.moveTo(topX, 0); ctx.lineTo(botX, H); ctx.stroke();
  ctx.restore();

  const vsX = seamX(0.5), vsY = H * 0.5;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 156px Cinzel, Georgia, serif';
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 20;
  ctx.fillStyle = '#dcb86f'; ctx.fillText('VS', vsX, vsY);
  const vsGrad = ctx.createLinearGradient(0, vsY - 88, 0, vsY + 88);
  vsGrad.addColorStop(0, '#f7e8bb'); vsGrad.addColorStop(0.5, '#dcb86f'); vsGrad.addColorStop(1, '#b88f3c');
  ctx.shadowColor = 'rgba(220,184,111,0.75)'; ctx.shadowBlur = 48;
  ctx.fillStyle = vsGrad; ctx.fillText('VS', vsX, vsY);
  ctx.shadowBlur = 10; ctx.fillText('VS', vsX, vsY);
  ctx.restore();

  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = GOLD; ctx.font = '600 46px Cinzel, Georgia, serif';
  track(8); ctx.fillText(String(opts.name || 'Match Snapshot').toUpperCase(), W / 2, 86); track(0);
  const details = [_fmtFullDate(match.date)];
  const tStr = _localTimeStr(match.date); if (tStr) details.push(tStr);
  if (match.duration) details.push(_fmtDur(match.duration));
  if (opts.location) details.push(String(opts.location).toUpperCase());
  ctx.fillStyle = 'rgba(220,184,111,0.8)'; ctx.font = "600 27px 'Hanken Grotesk', Roboto, Arial, sans-serif";
  track(1.5); ctx.fillText(details.filter(Boolean).join('   ·   '), W / 2, 134); track(0);

  ctx.textAlign = 'center';
  const winnerDisp = pWin ? pName : eWin ? eName : '';
  const banner = draw ? 'DRAW' : (winnerDisp.toUpperCase() + ' WINS');
  const bfs = _fitFont(ctx, banner, 'bold $px Cinzel, Georgia, serif', W - 2 * pad, 92, 48);
  ctx.font = `bold ${bfs}px Cinzel, Georgia, serif`;
  ctx.fillStyle = draw ? 'rgba(220,184,111,0.92)' : GOLD;
  ctx.save(); ctx.shadowColor = 'rgba(220,184,111,0.6)'; ctx.shadowBlur = 40;
  ctx.fillText(banner, W / 2, 226);
  ctx.shadowBlur = 6; ctx.fillText(banner, W / 2, 226);
  ctx.restore();

  function corner(name, avatarName, life, win, align, x) {
    ctx.textAlign = align;
    const NM = _clipText(name.toUpperCase(), 16);
    const showSub = avatarName && name.toUpperCase() !== String(avatarName).toUpperCase();
    ctx.fillStyle = (win || draw) ? GOLD_HI : 'rgba(233,226,207,0.5)';
    const nfs = _fitFont(ctx, NM, 'bold $px Cinzel, Georgia, serif', W * 0.46, 52, 30);
    ctx.font = `bold ${nfs}px Cinzel, Georgia, serif`;
    ctx.save(); if (win && !draw) { ctx.shadowColor = 'rgba(220,184,111,0.5)'; ctx.shadowBlur = 18; }
    ctx.fillText(NM, x, H * 0.795); ctx.restore();
    if (showSub) {
      ctx.fillStyle = (win || draw) ? 'rgba(233,226,207,0.62)' : 'rgba(233,226,207,0.4)';
      ctx.font = "italic 31px 'EB Garamond', Georgia, serif";
      ctx.fillText(_clipText(avatarName, 22), x, H * 0.832);
    }
    const lifeTxt = lifeText(life, !win && !draw);
    ctx.font = 'bold 168px Cinzel, Georgia, serif';
    ctx.save();
    if (win && !draw) { ctx.fillStyle = GOLD; ctx.shadowColor = 'rgba(220,184,111,0.55)'; ctx.shadowBlur = 34; }
    else ctx.fillStyle = draw ? CREAM : AETHER;
    ctx.fillText(lifeTxt, x, H * 0.965); ctx.restore();
  }
  corner(pName, match.playerAvatar, match.playerFinalLife, pWin, 'left', pad);
  corner(eName, match.enemyAvatar, match.enemyFinalLife, eWin, 'right', W - pad);

  return canvas;
}

/** Build + share the duel snapshot for a Compendium match. */
export async function shareMatchSnapshot(matchId, opts = {}) {
  const m = await getMatch(matchId);
  if (!m) throw new Error('Match not found');
  const match = {
    winner: m.winner === 'opponent' ? 'enemy' : m.winner,   // player | enemy | draw
    profile: opts.playerName || 'You',
    playerAvatar: m.player_avatar, enemyAvatar: m.opponent_avatar,
    playerFinalLife: m.player_final_life, enemyFinalLife: m.opponent_final_life,
    date: m.played_at, duration: m.duration_sec, opponent: m.opponent_name,
  };
  const o = { name: 'Duel', playerName: opts.playerName || 'You', opponentName: m.opponent_name || m.opponent_avatar || 'Opponent', ...opts };
  const cv = await _renderMatchSnapshot(match, o);
  return shareImage(cv, `duel-${slugify(m.opponent_name || 'match')}.png`, 'Duel');
}
