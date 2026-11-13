/**
 * Fetan P2P Design System ("Sovereign Liquid Glass")
 *
 * Single source of truth for surface, ink, semantic, and glass material tokens.
 */

export const brand = {
  name: 'Fetan P2P',
  nameAm: 'ፈጣን P2P',
  tagline: 'Ethiopia P2P Escrow',
};

export const color = {
  // Brand & Core Ink
  green: '#008751',
  greenDark: '#006B40',
  greenDeep: '#063B27',
  gold: '#E5B418',
  goldDark: '#B88D0B',

  // Surfaces
  ink: '#0A1612',
  inkSoft: '#4B5752',
  paper: '#F3F4F2',
  paperWarm: '#EBE9E2',
  white: '#FFFFFF',
  line: 'rgba(10, 22, 18, 0.09)',

  // Semantic
  buy: '#008751',
  buySoft: '#E6F5EE',
  sell: '#C93B2B',
  sellSoft: '#FDECEB',
  warn: '#D97706',
  warnSoft: '#FEF3C7',
  info: '#1D64D0',
  infoSoft: '#E8F0FE',

  // Text
  text: '#0A1612',
  textSoft: '#4B5752',
  textMuted: '#7A8680',
};

export const radius = {
  xs: '8px',
  sm: '12px',
  md: '16px',
  lg: '20px',
  xl: '24px',
  '2xl': '28px',
  full: '9999px',
};

export const shadow = {
  card: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 6px 24px -8px rgba(10,22,18,0.07)',
  cardHover:
    'inset 0 1px 0 rgba(255,255,255,0.92), 0 12px 32px -10px rgba(10,22,18,0.12)',
  modal: 'inset 0 1px 0 rgba(255,255,255,0.85), 0 28px 64px -16px rgba(10,22,18,0.28)',
  glow: '0 0 0 1px rgba(0,135,81,0.28), 0 10px 28px rgba(0,135,81,0.18)',
};

export const motion = {
  fast: '140ms cubic-bezier(0.22, 1, 0.36, 1)',
  base: '220ms cubic-bezier(0.22, 1, 0.36, 1)',
  slow: '340ms cubic-bezier(0.22, 1, 0.36, 1)',
};

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
