/** Minimum time the loading screen stays up so the first tip can be read. */
export const SPLASH_MIN_MS = 2800;

declare global {
  interface Window {
    __twSplashStart?: number;
    __twSplashTimer?: number;
  }
}

/** Fades out and removes the loading screen defined in index.html once the app has rendered. */
export function dismissSplash(): void {
  const splash = document.getElementById('tw-splash');
  if (!splash) return;
  const started = window.__twSplashStart ?? Date.now();
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - started));
  window.setTimeout(() => {
    splash.classList.add('tw-hide');
    window.setTimeout(() => {
      if (window.__twSplashTimer) window.clearInterval(window.__twSplashTimer);
      splash.remove();
    }, 500);
  }, wait);
}
