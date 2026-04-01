export type AccentTheme = 'blue' | 'violet' | 'emerald' | 'rose' | 'midnight';

interface ThemeTokens {
  '--primary': string;
  '--primary-container': string;
  '--on-primary-container': string;
  '--on-primary-fixed': string;
  '--on-primary-fixed-variant': string;
  '--primary-fixed': string;
  '--primary-fixed-dim': string;
  '--inverse-primary': string;
  '--secondary': string;
  '--secondary-container': string;
  '--on-secondary-container': string;
}

// RGB triplets (space-separated) for Tailwind alpha support
const ACCENT_THEMES: Record<AccentTheme, ThemeTokens & { label: string; swatch: string }> = {
  blue: {
    label: 'Ocean Blue',
    swatch: '#4A6CF7',
    '--primary': '74 108 247',
    '--primary-container': '238 242 255',
    '--on-primary-container': '59 93 231',
    '--on-primary-fixed': '30 58 138',
    '--on-primary-fixed-variant': '59 93 231',
    '--primary-fixed': '219 234 254',
    '--primary-fixed-dim': '147 180 253',
    '--inverse-primary': '147 180 253',
    '--secondary': '99 102 241',
    '--secondary-container': '238 242 255',
    '--on-secondary-container': '79 70 229',
  },
  violet: {
    label: 'Royal Violet',
    swatch: '#8B5CF6',
    '--primary': '139 92 246',
    '--primary-container': '245 243 255',
    '--on-primary-container': '124 58 237',
    '--on-primary-fixed': '76 29 149',
    '--on-primary-fixed-variant': '109 40 217',
    '--primary-fixed': '237 233 254',
    '--primary-fixed-dim': '196 181 253',
    '--inverse-primary': '196 181 253',
    '--secondary': '168 85 247',
    '--secondary-container': '250 245 255',
    '--on-secondary-container': '147 51 234',
  },
  emerald: {
    label: 'Fresh Emerald',
    swatch: '#10B981',
    '--primary': '16 185 129',
    '--primary-container': '236 253 245',
    '--on-primary-container': '5 150 105',
    '--on-primary-fixed': '6 78 59',
    '--on-primary-fixed-variant': '4 120 87',
    '--primary-fixed': '209 250 229',
    '--primary-fixed-dim': '110 231 183',
    '--inverse-primary': '110 231 183',
    '--secondary': '20 184 166',
    '--secondary-container': '240 253 250',
    '--on-secondary-container': '13 148 136',
  },
  rose: {
    label: 'Coral Rose',
    swatch: '#F43F5E',
    '--primary': '244 63 94',
    '--primary-container': '255 241 242',
    '--on-primary-container': '225 29 72',
    '--on-primary-fixed': '136 19 55',
    '--on-primary-fixed-variant': '190 18 60',
    '--primary-fixed': '255 228 230',
    '--primary-fixed-dim': '253 164 175',
    '--inverse-primary': '253 164 175',
    '--secondary': '251 113 133',
    '--secondary-container': '255 241 242',
    '--on-secondary-container': '244 63 94',
  },
  midnight: {
    label: 'Midnight',
    swatch: '#0E172A',
    '--primary': '14 23 42',
    '--primary-container': '226 232 240',
    '--on-primary-container': '30 41 59',
    '--on-primary-fixed': '2 6 23',
    '--on-primary-fixed-variant': '15 23 42',
    '--primary-fixed': '241 245 249',
    '--primary-fixed-dim': '148 163 184',
    '--inverse-primary': '148 163 184',
    '--secondary': '51 65 85',
    '--secondary-container': '241 245 249',
    '--on-secondary-container': '30 41 59',
  },
};

const STORAGE_KEY = 'dwellhub-accent-theme';

export function getAccentThemes() {
  return ACCENT_THEMES;
}

export function getSavedTheme(): AccentTheme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved in ACCENT_THEMES) return saved as AccentTheme;
  } catch { /* noop */ }
  return 'midnight';
}

export function applyTheme(theme: AccentTheme) {
  const tokens = ACCENT_THEMES[theme];
  if (!tokens) return;
  const root = document.documentElement;
  (Object.keys(tokens) as (keyof ThemeTokens)[]).forEach((key) => {
    if (key.startsWith('--')) {
      root.style.setProperty(key, tokens[key]);
    }
  });
  // Update meta theme-color to match primary
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', tokens.swatch);

  localStorage.setItem(STORAGE_KEY, theme);
}

// Auto-initialize on module load
applyTheme(getSavedTheme());
