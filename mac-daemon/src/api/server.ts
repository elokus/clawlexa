import express, { Express, Request, Response, NextFunction } from 'express';
import { createServer as createHttpServer, Server as HttpServer } from 'http';
import cors from 'cors';
import { SessionManager } from '../sessions/manager.js';
import { createSessionRoutes } from './routes.js';

export interface ServerConfig {
  port: number;
  sessionManager: SessionManager;
}

export interface ServerResult {
  app: Express;
  httpServer: HttpServer;
}

export function createServer(config: ServerConfig): ServerResult {
  const app = express();

  // Middleware
  app.use(cors()); // Enable CORS for browser connections
  app.use(express.json());

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[API] ${req.method} ${req.path}`);
    next();
  });

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  });

  // Session routes
  app.use('/', createSessionRoutes(config.sessionManager));

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Not found',
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[API] Error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error',
    });
  });

  // Create HTTP server for WebSocket upgrade support
  const httpServer = createHttpServer(app);

  return { app, httpServer };
}

export async function startServer(config: ServerConfig): Promise<HttpServer> {
  const { httpServer } = createServer(config);

  return new Promise((resolve) => {
    httpServer.listen(config.port, () => {
      console.log(`[API] Server listening on port ${config.port}`);
      resolve(httpServer);
    });
  });
}
