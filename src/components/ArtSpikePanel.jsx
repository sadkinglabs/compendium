// Phase-2a device-spike panel: an on-screen harness (no console needed on device) to verify the native
// art-download path before 2b. Runs the probe (downloadFile vs CapacitorHttp, exact-size + 2xx gated),
// shows the JSON report + device details, and loads the orchestrated cached src into a real <img> so
// convertFileSrc is proven end to end. Rendered ONLY when built with VITE_ART_SPIKE=1 (App.jsx), so it
// is absent from every normal build; removed once the result is recorded. See the 2a review brief.
import { useState } from 'react';
import { runArtDownloadSpike } from '../store/artCacheSpike.js';

// Prefill with a known object (fill in a real uploaded key+bytes; e.g. from the prospective manifest).
const PRESET_KEY = '';
const PRESET_BYTES = '';

export default function ArtSpikePanel() {
  const [key, setKey] = useState(PRESET_KEY);
  const [bytes, setBytes] = useState(PRESET_BYTES);
  const [report, setReport] = useState(null);
  const [imgState, setImgState] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setReport(null); setImgState('');
    try { setReport(await runArtDownloadSpike(key.trim(), parseInt(bytes, 10))); }
    catch (e) { setReport({ error: String(e?.message || e) }); }
    setBusy(false);
  };

  const src = report?.orchestrated?.src || null;
  const box = { position: 'fixed', inset: 0, zIndex: 99999, background: '#120d09', color: '#e8dcc0', padding: 16, overflow: 'auto', font: '13px/1.4 monospace' };
  return (
    <div style={box}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Art download spike (Phase 2a)</div>
      <input placeholder="content key (must exist on the CDN)" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: '100%', marginBottom: 6, padding: 6 }} />
      <input placeholder="exact bytes" value={bytes} onChange={(e) => setBytes(e.target.value)} style={{ width: '100%', marginBottom: 6, padding: 6 }} />
      <button onClick={run} disabled={busy} style={{ padding: '8px 16px', marginBottom: 12 }}>{busy ? 'running…' : 'Run spike'}</button>
      {src && (
        <div style={{ marginBottom: 12 }}>
          <div>orchestrated cached src -&gt; &lt;img&gt;: <b>{imgState || 'loading…'}</b></div>
          <img src={src} alt="cached" onLoad={() => setImgState('LOADED OK')} onError={() => setImgState('IMG ERROR')} style={{ maxWidth: 200, border: '1px solid #5a4a2a', marginTop: 6 }} />
        </div>
      )}
      {report && <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(report, null, 2)}</pre>}
    </div>
  );
}
