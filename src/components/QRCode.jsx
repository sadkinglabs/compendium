// Client-side QR (zero-dependency generator). Renders dark modules on a light
// card - highest scan reliability - as an inline SVG. Used to hand a match to
// an opponent's camera at match end.
import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export default function QRCode({ text, size = 224 }) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');            // auto version, error-correction M
      qr.addData(text || '');
      qr.make();
      const n = qr.getModuleCount(), quiet = 2, total = n + quiet * 2;
      let rects = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        // 1.02 overdraw closes hairline seams between cells at fractional scales
        if (qr.isDark(r, c)) rects += `<rect x="${c + quiet}" y="${r + quiet}" width="1.02" height="1.02"/>`;
      }
      return `<svg viewBox="0 0 ${total} ${total}" width="100%" height="100%" shape-rendering="crispEdges" fill="#0b0806" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
    } catch { return ''; }
  }, [text]);
  return (
    <div style={{ width: size, height: size, background: '#f3ead6', borderRadius: 16, padding: 14, boxSizing: 'border-box', boxShadow: '0 8px 26px -8px rgba(0,0,0,.6)' }}
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
