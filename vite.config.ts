import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' so the static build works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
