import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { dismissSplash } from './splash';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Let the first frame paint behind the loading screen, then fade it out.
window.requestAnimationFrame(() => window.requestAnimationFrame(dismissSplash));
