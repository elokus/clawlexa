import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pi hostname - use IP address for reliable browser resolution
// mDNS (.local) works in curl but not always in browsers
const PI_HOST = process.env.PI_HOST || '192.168.0.164';

export default defineConfig({
  plugins: [react()],
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
      },
    },
  },
});
