/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        ds: {
          bg: '#020617',
          surface: '#0F172A',
          surface2: '#1E293B',
          text: '#F8FAFC',
          muted: '#94A3B8',
          border: '#334155',
          accent: '#22C55E',
          'accent-hover': '#16A34A',
        }
      },
      fontFamily: {
        heading: ['"Fira Code"', 'monospace'],
        body: ['"Fira Sans"', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
