import { loadConfig } from './config.js';
import { SessionManager } from './sessions/manager.js';
import { startServer } from './api/server.js';
import { createWebSocketServer } from './api/websocket.js';
import { tmuxManager } from './tmux/manager.js';
import { ptyManager } from './pty/index.js';

async function main() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║      Mac Daemon - CLI Session Manager ║');
  console.log('╚═══════════════════════════════════════╝');

  const config = loadConfig();

  // Log demo mode status
  if (config.demoMode) {
    console.log('[Init] ⚠️  DEMO_MODE enabled - terminal sessions will start without commands');
  }

  // Check tmux availability
  const tmuxAvailable = await tmuxManager.checkTmuxAvailable();
  if (!tmuxAvailable) {
    console.error('[Error] tmux is not installed or not in PATH');
    console.error('Please install tmux: brew install tmux');
    process.exit(1);
  }
  console.log('[Init] tmux is available');

  // Initialize session manager
  const sessionManager = new SessionManager({
    piWebhookUrl: config.piWebhookUrl,
    demoMode: config.demoMode,
  });

  // Recover any existing sessions
  const recovered = await sessionManager.recoverSessions();
  if (recovered > 0) {
    console.log(`[Init] Recovered ${recovered} existing tmux sessions`);
  }

  // Start status monitoring
  sessionManager.start();

  // Start HTTP server
  const httpServer = await startServer({
    port: config.port,
    sessionManager,
  });

  // Initialize WebSocket server for PTY streaming
  createWebSocketServer({
    httpServer,
    sessionManager,
  });

  console.log(`[Ready] Mac Daemon running on http://localhost:${config.port}`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  POST   /sessions              Create new session');
  console.log('  GET    /sessions              List all sessions');
  console.log('  GET    /sessions/:id          Get session details');
  console.log('  POST   /sessions/:id/input    Send input to session');
  console.log('  GET    /sessions/:id/output   Read output buffer');
  console.log('  DELETE /sessions/:id          Terminate session');
  console.log('  GET    /health                Health check');
  console.log('');
  console.log('WebSocket endpoints:');
  console.log('  WS     /sessions/:id/terminal  PTY terminal stream');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[Shutdown] Stopping daemon...');
    ptyManager.closeAll();
    sessionManager.stop();
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('[Fatal]', error);
  process.exit(1);
});
