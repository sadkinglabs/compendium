// The ongoing-match snapshot: the single source of the resumable-match SERIALIZED CONTRACT
// - its field mapping, defaults, validity, and version. LifeCounter produces it and its
// resume initializers consume it; App.resumeMatch consumes the identity fields; and
// ongoingMatch.js (the profile-scoped localStorage adapter) persists/validates it. Keeping
// the shape here - in the store layer, not the pillar that happens to build it - is what
// lets those consumers not drift apart: add a field in ONE place (build + read) and every
// reader is defined against the same contract. Run: npm run test:query
//
// This owns the FIELD SHAPE only. Life/max RANGE rules (the <=20 cap) stay in matchLife.js:
// readMatchSnapshot returns life/max RAW, and the caller clamps via restoreSide.

/** @typedef {{ life: number, max: number }} Side */

export const SNAP_VERSION = 1;   // bump only on a real shape change (and add a migration)

/**
 * Assemble the resumable snapshot from live match values. The one definition of the shape:
 * normalized `p`/`e` sides become flat pLife/pMax/eLife/eMax on disk; optional fields default.
 * @param {{ mode, settings, you, opp, deck, p: Side, e: Side, log?, elapsedSec?, oppName?, recorded?, clockOn?, band? }} state
 */
export function buildMatchSnapshot({ mode, settings, you, opp, deck, p, e, log, elapsedSec, oppName, recorded, clockOn, band }) {
  return {
    v: SNAP_VERSION,
    mode, settings, you: you || null, opp: opp || null, deck: deck || null,
    pLife: p.life, pMax: p.max, eLife: e.life, eMax: e.max,
    log: log || [], elapsedSec: elapsedSec || 0, oppName: oppName || '', recorded: !!recorded, clockOn: !!clockOn,
    // Advanced Counter Band (optional, defaults 0 - NO version bump: an old
    // snapshot without these resumes as zeros, and validity does not gate on
    // them). Flat on disk like life/max; bandState.restoreBand clamps on read.
    pMana: band?.p?.mana ?? 0, pAir: band?.p?.air ?? 0, pEarth: band?.p?.earth ?? 0, pFire: band?.p?.fire ?? 0, pWater: band?.p?.water ?? 0,
    eMana: band?.e?.mana ?? 0, eAir: band?.e?.air ?? 0, eEarth: band?.e?.earth ?? 0, eFire: band?.e?.fire ?? 0, eWater: band?.e?.water ?? 0,
  };
}

/**
 * Read a persisted snapshot into the normalized values every consumer needs, applying the
 * same defaults. Life/max are returned RAW as `{ p, e }` sides - the caller clamps them via
 * matchLife.restoreSide (the range rule lives there, not here). `clockOn` uses `??` so an
 * explicit stored `false` is preserved rather than re-defaulted.
 */
export function readMatchSnapshot(s) {
  return {
    mode: s.mode, settings: s.settings, you: s.you || null, opp: s.opp || null, deck: s.deck || null,
    p: { life: s.pLife, max: s.pMax }, e: { life: s.eLife, max: s.eMax },
    log: s.log || [], elapsedSec: s.elapsedSec || 0, oppName: s.oppName || '', recorded: !!s.recorded, clockOn: s.clockOn ?? false,
    // Raw band values - the caller clamps via bandState.restoreBand (range rules
    // live there, not here; the same split as life/max -> restoreSide).
    band: {
      p: { mana: s.pMana, air: s.pAir, earth: s.pEarth, fire: s.pFire, water: s.pWater },
      e: { mana: s.eMana, air: s.eAir, earth: s.eEarth, fire: s.eFire, water: s.eWater },
    },
  };
}

/**
 * Structural validity for resume: the version matches and the load-bearing life/max fields
 * are finite. Range (<=20) is NOT checked here - restoreSide clamps on read, so a stale or
 * out-of-range-but-finite snapshot still resumes (clamped) rather than being discarded.
 */
export function isValidMatchSnapshot(s) {
  return !!s && s.v === SNAP_VERSION
    && Number.isFinite(s.pLife) && Number.isFinite(s.pMax)
    && Number.isFinite(s.eLife) && Number.isFinite(s.eMax);
}
