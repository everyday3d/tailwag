/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tailwag: {
          bg: '#0b0e14',
          panel: '#121722',
          card: '#181f2e',
          border: '#252f42',
          accent: '#f97316',
          gold: '#f59e0b',
        }
      }
    },
  },
  plugins: [],
}
