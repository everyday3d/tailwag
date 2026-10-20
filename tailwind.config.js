/** @type {import('tailwindcss').Config} */
// Design tokens for the facelift ("print bench"). Values live as CSS variables in
// src/index.css so Tailwind classes, inline canvas code and future themes share them.
// Use these names in new UI instead of raw hex values or slate/orange shades.
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tw: {
          ground: 'rgb(var(--twg-ground) / <alpha-value>)', // app background, 3D view surround
          panel: 'rgb(var(--twg-panel) / <alpha-value>)', // side panels, header, dialogs
          raised: 'rgb(var(--twg-raised) / <alpha-value>)', // secondary buttons, cards in panels
          hover: 'rgb(var(--twg-hover) / <alpha-value>)',
          line: 'rgb(var(--twg-line) / <alpha-value>)', // borders and dividers
          'line-strong': 'rgb(var(--twg-line-strong) / <alpha-value>)',
          ink: 'rgb(var(--twg-ink) / <alpha-value>)', // primary text
          'ink-2': 'rgb(var(--twg-ink-2) / <alpha-value>)', // secondary text
          'ink-3': 'rgb(var(--twg-ink-3) / <alpha-value>)', // hints, units (still 4.5:1 on panel)
          accent: 'rgb(var(--twg-accent) / <alpha-value>)', // main action and selection only
          'accent-ink': 'rgb(var(--twg-accent-ink) / <alpha-value>)', // text on accent
          'accent-text': 'rgb(var(--twg-accent-text) / <alpha-value>)', // accent-coloured text on dark
          ok: 'rgb(var(--twg-ok) / <alpha-value>)',
          warn: 'rgb(var(--twg-warn) / <alpha-value>)',
          danger: 'rgb(var(--twg-danger) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Type scale: nothing smaller than 11 px; 13 px body.
        micro: ['11px', { lineHeight: '15px' }], // units, captions
        small: ['12px', { lineHeight: '17px' }], // labels, secondary text
        body: ['13px', { lineHeight: '19px' }], // default UI text
        title: ['15px', { lineHeight: '21px', fontWeight: '600' }], // section titles in the centre
        heading: ['18px', { lineHeight: '24px', fontWeight: '600' }], // dialog titles
      },
      borderRadius: {
        control: '8px', // buttons, inputs, segments
        card: '12px', // panels, cards, the 3D view
      },
    },
  },
  plugins: [],
}
