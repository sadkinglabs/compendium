// The pillar-change loading screen: the app's gold diamond breathing on the dark
// ground, filling the body area while a pillar's chunk loads.
//
// Replaces a centered "· · ·" at the top of an otherwise empty screen, which read
// as an unfinished frame rather than an intentional state (owner report).
//
// Three deliberate properties:
//  - INSTANT. The mark is solid on the first painted frame: no entrance delay, no
//    fade. The first cut waited 140ms then faded in, guessing that a warm chunk
//    would resolve unseen; frame forensics disproved it (a cold pillar showed an
//    EMPTY body at 135ms and only filled near 690ms), so the delay bought nothing
//    and just relocated the blank frame the owner was complaining about.
//  - COMPOSITOR-ONLY PULSE. The breath animates opacity + transform only, never
//    filter/drop-shadow (the boot splash can afford a glow for one screen at
//    launch; an infinite paint-phase animation on every pillar change cannot -
//    DESIGN_SYSTEM §6). Reduced motion drops it to a still mark, per the same law.
//  - IT LETS THE WASH THROUGH. No opaque ground of its own, so the pillar's
//    top-down colour wash still reads and the transition into content is quiet.
import React from 'react';
import { DIAMOND_PATH, DIAMOND_GOLD } from './brandMark.js';

export default function PillarLoading({ size = 72 }) {
  return (
    <div className="cx-pillar-load" role="status" aria-label="Loading">
      <div className="cx-pillar-load-mark" style={{ lineHeight: 0 }}>
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
          <path d={DIAMOND_PATH} fill="none" stroke={DIAMOND_GOLD} strokeWidth="4" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}
