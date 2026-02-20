/**
 * Static File Server - Serves the web dashboard from the Pi.
 *
 * Serves the built web dashboard on port 8080.
 * Access from any device on the local network: http://marlon.local:8080
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Socket } from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_PORT = parseInt(process.env.STATIC_PORT ?? '8080', 10);

// Path to the built web dashboard (sibling package: packages/web-ui)
const STATIC_DIR = path.resolve(__dirname, '../../../web-ui/dist');

let server: http.Server | null = null;
const openConnections = new Set<Socket>();

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Serve static files from the web/dist directory.
 */
function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  // Only handle GET requests
  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  let urlPath = req.url ?? '/';

  // Remove query string
  const queryIndex = urlPath.indexOf('?');
  if (queryIndex !== -1) {
    urlPath = urlPath.substring(0, queryIndex);
  }

  // Default to index.html for root or SPA routes
  if (urlPath === '/' || !path.extname(urlPath)) {
    urlPath = '/index.html';
  }

  const filePath = path.join(STATIC_DIR, urlPath);

  // Security: Prevent directory traversal
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Check if file exists
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // For SPA, serve index.html for missing routes
      const indexPath = path.join(STATIC_DIR, 'index.html');
      fs.readFile(indexPath, (indexErr, data) => {
        if (indexErr) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
      });
      return;
    }

    // Serve the file
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(500);
        res.end('Internal Server Error');
        return;
      }

      // Set cache headers for assets
      const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=31536000';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': cacheControl,
      });
      res.end(data);
    });
  });
}

/**
 * Start the static file server.
 */
export function startStaticServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      console.log('[Static] Server already running');
      resolve();
      return;
    }

    // Check if dist directory exists
    if (!fs.existsSync(STATIC_DIR)) {
      console.log(`[Static] Warning: ${STATIC_DIR} not found. Build the web dashboard first.`);
      console.log('[Static] Run: cd ../web-ui && bun run build');
      resolve(); // Don't fail, just warn
      return;
    }

    server = http.createServer(handleRequest);
    openConnections.clear();

    server.on('connection', (socket) => {
      openConnections.add(socket);
      socket.on('close', () => {
        openConnections.delete(socket);
      });
    });

    server.on('error', (err) => {
      console.error('[Static] Server error:', err);
      server = null;
      openConnections.clear();
      reject(err);
    });

    server.listen(STATIC_PORT, '0.0.0.0', () => {
      console.log(`[Static] Dashboard server listening on port ${STATIC_PORT}`);
      console.log(`[Static] Access from local network: http://marlon.local:${STATIC_PORT}`);
      resolve();
    });
  });
}

/**
 * Stop the static file server.
 */
export function stopStaticServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    const currentServer = server;
    server = null;

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      openConnections.clear();
      resolve();
    };

    const timeout = setTimeout(() => {
      for (const socket of openConnections) {
        socket.destroy();
      }
      openConnections.clear();
      console.warn('[Static] Force shutdown after close timeout');
      finish();
    }, 2000);

    try {
      currentServer.close(() => {
        clearTimeout(timeout);
        console.log('[Static] Server stopped');
        finish();
      });
    } catch (error) {
      clearTimeout(timeout);
      console.warn('[Static] Error while closing server:', error);
      finish();
    }
  });
}
