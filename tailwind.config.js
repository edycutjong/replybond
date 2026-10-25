/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        card: 'var(--card)',
        ink: 'var(--ink)',
        muted: 'var(--muted)',
        before: 'var(--before)',
        after: 'var(--after)',
        rule: 'var(--rule)',
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        data: ['var(--font-data)'],
      },
    },
  },
  plugins: [],
}
