/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'forge': {
          'bg': '#0d0f1a',
          'surface': '#151829',
          'surface2': '#1c2040',
          'border': '#2a2f4a',
          'cyan': '#00e5ff',
          'orange': '#ff6b35',
          'text': '#e2e4f0',
          'text2': '#8b8fa8',
          'green': '#00e676',
          'red': '#ff3d5a',
          'yellow': '#ffd740',
        }
      },
      fontFamily: {
        'display': ['"Orbitron"', 'sans-serif'],
        'body': ['"Noto Sans SC"', 'sans-serif'],
      },
      animation: {
        'glow': 'glow 2s ease-in-out infinite alternate',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.4s ease-out',
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan-line': 'scanLine 3s linear infinite',
      },
      keyframes: {
        glow: {
          '0%': { boxShadow: '0 0 5px rgba(0, 229, 255, 0.3), 0 0 20px rgba(0, 229, 255, 0.1)' },
          '100%': { boxShadow: '0 0 10px rgba(0, 229, 255, 0.5), 0 0 40px rgba(0, 229, 255, 0.2)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 5px rgba(0, 229, 255, 0.2)' },
          '50%': { boxShadow: '0 0 20px rgba(0, 229, 255, 0.6)' },
        },
        scanLine: {
          '0%': { top: '-100%' },
          '100%': { top: '100%' },
        },
      },
    },
  },
  plugins: [],
}
