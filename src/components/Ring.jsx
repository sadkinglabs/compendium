import React from 'react';

// Completion Ring — governed primitive (DESIGN_SYSTEM.md §3; promoted [Candidate]→[Target],
// [Shipping] as of this consumer). A pure SVG stroke-dashoffset arc: no blend-mode, no
// backdrop-filter, no per-frame animation, so it clears the §6 WebView paint rules and is
// zero-image safe (vector, never a photo). Static by default → reduced-motion safe.
//
// The arc FILL is the CONTEXTUAL pillar accent, passed via `color` (default currentColor so
// the ring inherits its surroundings); only the TRACK is a token (--ring-track). No
// --ring-fill exists by design. Decorative by default (aria-hidden) — the value is carried by
// the adjacent mono figure; pass `label` only when nothing beside it announces the value.

const RADIUS = 16;
const CIRC = 2 * Math.PI * RADIUS; // ~100.53 in the 40x40 viewBox

export default function Ring({
  value = 0,
  size = 52,
  stroke = 5,
  color = 'currentColor',
  track = 'var(--ring-track)',
  showPct = true,
  label,
  children,
  ...rest
}) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  const offset = CIRC * (1 - v);
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  return (
    <span
      style={{
        position: 'relative', flex: 'none', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', width: size, height: size, color,
      }}
      {...a11y}
      {...rest}
    >
      <svg width={size} height={size} viewBox="0 0 40 40" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
        <circle cx="20" cy="20" r={RADIUS} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx="20" cy="20" r={RADIUS} fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={CIRC} strokeDashoffset={offset}
        />
      </svg>
      {children != null ? (
        <span style={{ position: 'absolute', display: 'inline-flex' }}>{children}</span>
      ) : showPct ? (
        <span style={{
          position: 'absolute', fontFamily: 'var(--f-mono)', fontVariantNumeric: 'tabular-nums',
          fontSize: Math.round(size * 0.21), color: 'var(--ink-body)',
        }}>
          {Math.round(v * 100)}%
        </span>
      ) : null}
    </span>
  );
}
