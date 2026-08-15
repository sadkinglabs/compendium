// The element pip - real element/threshold icon (from public/icons), falling back
// to the ▲ glyph in the element colour when the asset is missing or images are
// suppressed (§5 zero-image). Extracted to its own LEAF module for the Counter
// Band: LifeCounter's type-gate closure must not swallow all of ui.jsx to reach
// one pip. ui.jsx (ThresholdPips) imports it from here; every pillar shows the
// same pip.
import React from 'react';
import { elementIconUrl } from '../store/cardArt.js';

export function ElementPip({ el, color, size }) {
  const [broken, setBroken] = React.useState(false);
  const url = el ? elementIconUrl(el) : null;
  if (url && !broken) {
    return <img src={url} width={size} height={size} alt={el} onError={() => setBroken(true)}
      style={{ display: 'inline-block', verticalAlign: 'middle', objectFit: 'contain' }} />;
  }
  return <span style={{ fontSize: size - 1, lineHeight: 1, color: color || '#9aa6b2' }}>▲</span>;
}
