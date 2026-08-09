import type { Config } from 'tailwindcss';

/**
 * MaybeOS brand theme.
 *
 * The app styles most surfaces through Tailwind's `gray` scale and a `brand`
 * palette. Rather than rewrite every `text-gray-900` across the codebase, the
 * scales themselves are rebased onto the brand's warm paper/ink palette — so
 * existing screens inherit the brand without touching their markup.
 *
 * Source of truth: the "MaybeOS Design System" project (tokens/*.css).
 * Warm paper over near-black warm ink, one loud punk-red accent, moss and
 * mustard for semantics. No cool grays anywhere.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Warm white — never pure #fff, which reads cold against paper.
        white: '#FFFDF8',

        // Rebased neutral ramp: paper at the light end, ink at the dark end.
        gray: {
          50: '#F3EEE1',
          100: '#EAE3D2',
          200: '#D9CFBB',
          300: '#C4B89D',
          400: '#8B8072',
          500: '#7A6F62',
          600: '#4A423A',
          700: '#3A332C',
          800: '#2B251E',
          900: '#211C16',
          950: '#171310',
        },

        // Punk red — the single loud accent, carries every primary action.
        brand: {
          50: '#FBEFEF',
          100: '#F6DEDD',
          200: '#EFBFBF',
          300: '#E29494',
          400: '#D55A5F',
          500: '#C81E2C',
          600: '#C81E2C',
          700: '#9E1521',
          800: '#7C111A',
          900: '#5E0D14',
          950: '#3D080D',
        },

        paper: {
          DEFAULT: '#F3EEE1',
          dim: '#EAE3D2',
          deep: '#DFD5BC',
        },
        ink: {
          DEFAULT: '#211C16',
          soft: '#4A423A',
          faint: '#8B8072',
        },
        moss: { DEFAULT: '#4B5E3A', tint: '#DEE6D1' },
        mustard: { DEFAULT: '#C68A1E', tint: '#F1DFB8' },

        // Semantic ramps, muted rather than candy-colored. Existing screens
        // use green/yellow/red/blue utilities; these keep them on-brand.
        green: {
          50: '#DEE6D1', 100: '#DEE6D1', 200: '#C6D4B3', 300: '#A8BC8E',
          400: '#7E9861', 500: '#4B5E3A', 600: '#4B5E3A', 700: '#3C4B2E',
          800: '#2E3A24', 900: '#222B1B', 950: '#161C11',
        },
        yellow: {
          50: '#F1DFB8', 100: '#F1DFB8', 200: '#E8CD93', 300: '#DDB662',
          400: '#D2A03B', 500: '#C68A1E', 600: '#C68A1E', 700: '#9E6E18',
          800: '#7A5512', 900: '#5B3F0D', 950: '#3B2908',
        },
        red: {
          50: '#F6DEDD', 100: '#F6DEDD', 200: '#EFBFBF', 300: '#E29494',
          400: '#D55A5F', 500: '#C81E2C', 600: '#C81E2C', 700: '#9E1521',
          800: '#7C111A', 900: '#5E0D14', 950: '#3D080D',
        },
        // No blue exists in this palette; map it onto the neutral ramp so any
        // stray blue utility degrades to ink rather than breaking the scheme.
        blue: {
          50: '#EAE3D2', 100: '#EAE3D2', 200: '#D9CFBB', 300: '#C4B89D',
          400: '#8B8072', 500: '#4A423A', 600: '#4A423A', 700: '#3A332C',
          800: '#2B251E', 900: '#211C16', 950: '#171310',
        },
      },

      fontFamily: {
        sans: ['var(--font-sans-next)', 'Archivo', 'system-ui', 'sans-serif'],
        display: ['var(--font-display-next)', 'Young Serif', 'Georgia', 'serif'],
        mono: ['var(--font-mono-next)', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        xs: '0.75rem', sm: '0.875rem', base: '1rem', md: '1.125rem',
        lg: '1.375rem', xl: '1.75rem', '2xl': '2.25rem', '3xl': '3rem',
        '4xl': '4rem', '5xl': '4.5rem', '6xl': '5.5rem',
      },

      borderRadius: {
        sm: '4px', DEFAULT: '8px', md: '8px', lg: '14px', xl: '22px',
        '2xl': '22px', '3xl': '28px', full: '999px',
      },

      // The signature motif: a hard, unblurred offset shadow — cut paper
      // pinned to a board, not a soft SaaS drop shadow.
      boxShadow: {
        hard: '3px 3px 0 #211C16',
        'hard-sm': '2px 2px 0 #211C16',
        'hard-lg': '5px 5px 0 #211C16',
        'hard-accent': '3px 3px 0 #C81E2C',
        sm: '0 1px 2px rgba(33,28,22,0.08)',
        DEFAULT: '0 1px 2px rgba(33,28,22,0.08)',
        md: '0 4px 14px rgba(33,28,22,0.10)',
        lg: '0 12px 32px rgba(33,28,22,0.14)',
        none: 'none',
      },

      transitionTimingFunction: { standard: 'cubic-bezier(.2,.8,.2,1)' },
      transitionDuration: { fast: '120ms', base: '180ms' },
      maxWidth: { container: '1200px' },
    },
  },
  plugins: [],
};

export default config;
