import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: {
          DEFAULT: '#172438',
          card: '#2a4b63',
          hover: '#1f3550',
          active: '#2d5269',
          border: '#26384f',
          muted: '#a3b3c5',
        },
      },
      width: { sidebar: '15rem', 'sidebar-collapsed': '4.625rem' },
      spacing: { sidebar: '15rem', 'sidebar-collapsed': '4.625rem' },
    },
  },
  plugins: [],
} satisfies Config;
