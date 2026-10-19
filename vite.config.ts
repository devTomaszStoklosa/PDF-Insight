import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// GitHub Pages serves the app from /<repo>/, so CI sets VITE_BASE_PATH (e.g. /PDF-Insight/).
// Locally it falls back to /. At runtime use import.meta.env.BASE_URL, which follows `base`.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    base: env.VITE_BASE_PATH ?? '/',
    plugins: [react()],
  };
});
