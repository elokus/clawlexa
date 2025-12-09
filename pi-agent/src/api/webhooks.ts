/**
 * Webhook API - Receives status updates from the Mac daemon.
 *
 * The Mac daemon sends POST requests to /webhooks/cli-status when:
 * - A session finishes
 * - A session encounters an error
 * - A session is waiting for input
 *
 * This allows the Pi to react to session changes proactively.
 */

import http from 'http';
import {
  CliSessionsRepository,
  CliEventsRepository,
  type SessionStatus,
} from '../db/index.js';

const PORT = parseInt(process.env.WEBHOOK_PORT ?? '3000', 10);

interface WebhookPayload {
  sessionId: string;
  status: 'running' | 'waiting_for_input' | 'finished' | 'error';
  message?: string;
  output?: string[];
}

type WebhookHandler = (payload: WebhookPayload) => Promise<void>;

let webhookHandler: WebhookHandler | null = null;
let server: http.Server | null = null;

// Pending session completions - resolve when webhook received
const pendingCompletions = new Map<
  string,
  { resolve: (payload: WebhookPayload) => void; timeout: ReturnType<typeof setTimeout> }
>();

/**
 * Set a handler for webhook events.
 * This can be used to notify the agent about session changes.
 */
export function onWebhookEvent(handler: WebhookHandler): void {
  webhookHandler = handler;
}

/**
 * Wait for a session to complete via webhook (no polling).
 * Returns when the webhook is received or timeout is reached.
 */
export function waitForSessionCompletion(
  sessionId: string,
  timeoutMs = 300_000
): Promise<WebhookPayload | null> {
  return new Promise((resolve) => {
    // Check if already completed
    const timeout = setTimeout(() => {
      pendingCompletions.delete(sessionId);
      console.log(`[Webhook] Timeout waiting for session ${sessionId}`);
      resolve(null);
    }, timeoutMs);

    pendingCompletions.set(sessionId, { resolve, timeout });
    console.log(`[Webhook] Waiting for session ${sessionId} completion via webhook`);
  });
}

/**
 * Resolve a pending session completion (called when webhook received).
 */
function resolvePendingCompletion(payload: WebhookPayload): void {
  const pending = pendingCompletions.get(payload.sessionId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingCompletions.delete(payload.sessionId);
    console.log(`[Webhook] Session ${payload.sessionId} status: ${payload.status}`);
    pending.resolve(payload);
  }
}

/**
 * Handle incoming webhook requests.
 */
async function handleWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  // Handle health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Handle CLI status webhook
  if (req.method === 'POST' && req.url === '/webhooks/cli-status') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body) as WebhookPayload;

        console.log('[Webhook] Received CLI status update:');
        console.log(`  Session: ${payload.sessionId}`);
        console.log(`  Status: ${payload.status}`);
        if (payload.message) {
          console.log(`  Message: ${payload.message}`);
        }

        // Update database
        const sessionsRepo = new CliSessionsRepository();
        const eventsRepo = new CliEventsRepository();

        // Map daemon status to our status
        const statusMap: Record<string, SessionStatus> = {
          running: 'running',
          waiting_for_input: 'waiting_for_input',
          finished: 'finished',
          error: 'error',
        };

        const dbStatus = statusMap[payload.status] ?? 'running';
        sessionsRepo.updateStatus(payload.sessionId, dbStatus);

        eventsRepo.create({
          session_id: payload.sessionId,
          event_type: 'status_change',
          payload: {
            status: payload.status,
            message: payload.message,
          },
        });

        // Resolve any pending completion waiters
        if (payload.status === 'finished' || payload.status === 'error') {
          resolvePendingCompletion(payload);
        }

        // Notify handler if registered
        if (webhookHandler) {
          await webhookHandler(payload);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      } catch (error) {
        console.error('[Webhook] Error processing request:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });

    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

/**
 * Start the webhook server.
 */
export function startWebhookServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      console.log('[Webhook] Server already running');
      resolve();
      return;
    }

    server = http.createServer(handleWebhook);

    server.on('error', (err) => {
      console.error('[Webhook] Server error:', err);
      reject(err);
    });

    server.listen(PORT, '0.0.0.0', () => {
      console.log(`[Webhook] Server listening on port ${PORT}`);
      console.log(`[Webhook] Endpoint: POST http://0.0.0.0:${PORT}/webhooks/cli-status`);
      resolve();
    });
  });
}

/**
 * Stop the webhook server.
 */
export function stopWebhookServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      console.log('[Webhook] Server stopped');
      server = null;
      resolve();
    });
  });
}

/**
 * Get the webhook URL for the Mac daemon to call.
 */
export function getWebhookUrl(): string {
  // Get the Pi's hostname or IP
  const hostname = process.env.PI_HOSTNAME ?? 'marlon.local';
  return `http://${hostname}:${PORT}/webhooks/cli-status`;
}
