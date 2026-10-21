import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { dismissSplash } from './splash';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
// Fonts for clock numerals and name plates (printFonts.ts): Latin only, one weight each
import '@fontsource/ibm-plex-sans/latin-700.css';
import '@fontsource/playfair-display/latin-700.css';
import '@fontsource/cinzel/latin-700.css';
import '@fontsource/bebas-neue/latin-400.css';
import '@fontsource/pacifico/latin-400.css';
// This package's export map adds ".css" itself
import '@fontsource/alfa-slab-one/latin-400';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Let the first frame paint behind the loading screen, then fade it out.
window.requestAnimationFrame(() => window.requestAnimationFrame(dismissSplash));
