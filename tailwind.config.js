/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './lib/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        void: {
          DEFAULT: '#05070d',
          950: '#03050a',
          900: '#0a1020',
          800: '#121c34',
        },
        accent: {
          DEFAULT: '#2ec9a5',
          bright: '#76f7d2',
          dim: '#177f73',
        },
        mint: '#76f7d2',
        trail: '#f6b85a',
        hud: {
          border: 'rgba(120, 160, 255, 0.28)',
          glass: 'rgba(8, 14, 26, 0.72)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        hud: '0 8px 32px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.06)',
        glass: '0 8px 28px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
        panel: '0 28px 80px rgba(0, 0, 0, 0.7)',
        glow: '0 0 40px rgba(118, 247, 210, 0.32)',
      },
      animation: {
        'fade-up': 'fadeUp 0.45s ease-out',
        'loc-toast': 'locToast 6s ease forwards',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        locToast: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '10%': { opacity: '1', transform: 'translateY(0)' },
          '80%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
