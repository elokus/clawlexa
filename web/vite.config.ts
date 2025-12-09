import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://marlon.local:3000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://marlon.local:3001',
        ws: true,
      },
    },
  },
});
