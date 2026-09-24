// Tailwind v4 is CSS-first (03 §13.3) — the only PostCSS work needed is
// running its own plugin over globals.css.
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
