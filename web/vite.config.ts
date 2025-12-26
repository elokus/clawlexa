import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Backend host configuration:
// - For Pi mode (default): PI_HOST=192.168.0.164 or marlon.local
// - For local Mac mode: PI_HOST=localhost
const PI_HOST = process.env.PI_HOST || 'localhost';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: `http://${PI_HOST}:3000`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://${PI_HOST}:3001`,
        ws: true,
        // Properly handle WebSocket upgrades
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('[Proxy] WebSocket error:', err.message);
          });
          proxy.on('proxyReqWs', (proxyReq, req, socket) => {
            console.log('[Proxy] WebSocket upgrade request');
          });
        },
      },
    },
  },
  // SPA mode: enables history API fallback for client-side routing
  // Routes like /session/:id and /dev are handled by React Router
  appType: 'spa',
});
