import colors from 'tailwindcss/colors';

// The codebase uses fine-grained shade numbers (e.g. bg-rose-455, border-slate-750)
// that don't exist in Tailwind's default 50/100/200.../950 scale, so those utility
// classes were silently generating no CSS at all. This fills in every shade in
// steps of 5 between the real stops by interpolating the surrounding colors,
// so classes like `slate-455` resolve to an actual color instead of nothing.
const STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function expandShades(base) {
  const out = {};
  for (let n = 50; n <= 950; n += 5) {
    if (n <= STOPS[0]) { out[n] = base[STOPS[0]]; continue; }
    if (n >= STOPS[STOPS.length - 1]) { out[n] = base[STOPS[STOPS.length - 1]]; continue; }
    let lower = STOPS[0], upper = STOPS[STOPS.length - 1];
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (n >= STOPS[i] && n <= STOPS[i + 1]) { lower = STOPS[i]; upper = STOPS[i + 1]; break; }
    }
    const t = (n - lower) / (upper - lower);
    const c1 = hexToRgb(base[lower]);
    const c2 = hexToRgb(base[upper]);
    out[n] = rgbToHex([lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]);
  }
  return out;
}

// The whole app was built entirely on the `rose` palette as its one brand
// accent (buttons, focus rings, active states — nothing semantic hangs off
// "rose" specifically). Rebranding to Ventra means that palette should mean
// the brand's pine/emerald green instead of orange, everywhere, at once — so
// we redefine what `rose` IS rather than hunt down every bg-rose-600 across
// 49 files. Every rose-* class in the app now renders these tones automatically.
const BRAND = {
  50: '#EAF7F1', 100: '#CDEEE0', 200: '#9EDDC3', 300: '#67C7A0', 400: '#34AC7E',
  500: '#17925F', 600: '#0E6E52', 700: '#0B5A43', 800: '#0A4736', 900: '#08362A', 950: '#041D16',
};

// Same trick for the warm accents: the stock `amber` read as orange next to the
// green brand, and `orange` was a second, off-brand accent. `amber` becomes a
// softer golden yellow (still reads as "atención/pendiente"), and `orange`
// becomes the olive-lime secondary accent of the Ventra look.
const WARN = {
  50: '#FEFBEA', 100: '#FDF3C4', 200: '#FBE68A', 300: '#F6D34E', 400: '#EDBE24',
  500: '#D9A70F', 600: '#B5870A', 700: '#8C660C', 800: '#6E5010', 900: '#5A4212', 950: '#33240A',
};
const LIME_ACCENT = {
  50: '#F7FAE8', 100: '#EDF4C8', 200: '#DDEA97', 300: '#C9DC62', 400: '#B3CB3A',
  500: '#93AE25', 600: '#74891B', 700: '#58691A', 800: '#46531A', 900: '#3B461A', 950: '#1E2609',
};

const expandedFamilies = {
  slate: expandShades(colors.slate),
  rose: expandShades(BRAND),
  indigo: expandShades(colors.indigo),
  emerald: expandShades(colors.emerald),
  amber: expandShades(WARN),
  orange: expandShades(LIME_ACCENT),
  sky: expandShades(colors.sky),
  teal: expandShades(colors.teal),
};

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { 50: BRAND[50], 100: BRAND[100], 200: BRAND[200], 300: BRAND[300], 400: BRAND[400], 500: BRAND[500], 600: BRAND[600], 700: BRAND[700], 800: BRAND[800], 900: BRAND[900] },
        surface: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a' },
        ...expandedFamilies,
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        outfit: ['Bricolage Grotesque', 'Outfit', 'Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Same story as the colors above: the code uses Tailwind v4-only utilities
      // (shadow-xs/2xs, w-4.5/h-4.5) on a v3 project, so these were no-ops too.
      boxShadow: {
        '2xs': '0 1px rgba(0, 0, 0, 0.04)',
        xs: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      },
      spacing: {
        '4.5': '1.125rem',
        '5.5': '1.375rem',
      },
      animation: { 'pulse-soft': 'pulseSoft 2s infinite' },
      keyframes: { pulseSoft: { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.5' } } },
    },
  },
  plugins: [],
};
