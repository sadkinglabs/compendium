import React from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import App from './App.jsx';
import { initNative } from './native.js';
import { initViewportInsets } from './appearance.js';

initNative(); // native status-bar tint (no-op on web)
initViewportInsets(); // --kb soft-keyboard inset for bottom sheets

// Web SQLite uses sql.js directly (see store/db.js); no custom-element setup needed.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
