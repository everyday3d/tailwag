/** App version from package.json, injected by Vite at build time ('dev' when not injected). */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
