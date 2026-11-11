/**
 * Fetan P2P Design System
 *
 * Single source of truth for colors, spacing, radius, type and motion.
 * Tailwind config reads from here; components use the exported tokens for
 * inline styles (e.g. payment-rail accent colors).
 */

export const brand = {
  name: 'Fetan P2P',
  nameAm: 'потенциал P2P',
  tagline: ' Ethiopia P2P',
};

// Core palette — Ethiopian flag inspired: green primary, gold accent, ink dark.
export const color = {
  // Brand
  green: '#009B57',
  greenDark: '#007A45',
  greenDeep: '#064E3B',
  gold: '#F5C518',
  goldDark: '#C99E10',

  // Surfaces
  ink: '#0B1F14',
  inkSoft: '#132A20',
  paper: '#F7F7F4',
  paperWarm: '#F0EDE6',
  white: '#FFFFFF',
  line: '#E4E1D8',

  // Semantic
  buy: '#009B57',
  buySoft: '#E6F6EC',
  sell: '#D64531',
  sellSoft: '#FBE9E6',
  warn: '#E0A916',
  warnSoft: '#FBF1D4',
  info: '#1E6FD6',
  infoSoft: '#E6F0FB',

  // Text
  text: '#111827',
  textSoft: '#4B5563',
  textMuted: '#8B939A',
};

export const radius = {
  xs: '6px',
  sm: '10px',
  md: '14px',
  lg: '18px',
  xl: '24px',
  '2xl': '28px',
  full: '9999px',
};

export const shadow = {
  card: '0 1px 2px rgba(11,31,20,0.04), 0 1px 3px rgba(11,31,20,0.06)',
  cardHover:
    '0 4px 6px rgba(11,31,20,0.06), 0 2px 4px rgba(11,31,20,0.06)',
  modal: '0 24px 60px rgba(11,31,20,0.28)',
  glow: '0 0 0 1px rgba(0,155,87,0.35), 0 8px 24px rgba(0,155,87,0.25)',
};

export const motion = {
  fast: '120ms ease',
  base: '200ms ease',
  slow: '320ms ease',
};

// Semantic color map consumed by components that need runtime values.
export const semantic = {
  buy: color.buy,
  buySoft: color.buySoft,
  sell: color.sell,
  sellSoft: color.sellSoft,
  warn: color.warn,
  warnSoft: color.warnSoft,
  info: color.info,
  infoSoft: color.infoSoft,
};

export type Theme = typeof theme;
export const theme = { brand, color, radius, shadow, motion, semantic };

export default theme;