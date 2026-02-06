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
import fs from 'fs';
import path from 'path';
import {
  CliSessionsRepository,
  CliEventsRepository,
  SessionMessagesRepository,
  type SessionStatus,
} from '../db/index.js';
import { handleDemoRequest } from '../demo/index.js';
import { eventRecorder } from './event-recorder.js';
import { wsBroadcast } from './websocket.js';
import { logWebhookStatus } from '../logging/session-logger.js';
import {
  listPrompts,
  getPromptInfo,
  getPromptVersion,
  listVersions,
  createPromptVersion,
  setActiveVersion,
  createPrompt,
  getActivePromptRaw,
  type PromptConfig,
} from '../prompts/index.js';

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
 * Add CORS headers for browser requests.
 */
function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/**
 * Handle incoming webhook and API requests.
 */
async function handleWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  setCorsHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Handle health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Handle demo API routes
  if (req.url?.startsWith('/api/demo')) {
    const handled = await handleDemoRequest(req, res);
    if (handled) return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REST API for Sessions
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/sessions - List all sessions
  if (req.method === 'GET' && req.url === '/api/sessions') {
    try {
      const sessionsRepo = new CliSessionsRepository();
      const sessions = sessionsRepo.list();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
    } catch (error) {
      console.error('[API] Error fetching sessions:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch sessions' }));
    }
    return;
  }

  // GET /api/sessions/active - List active sessions only
  if (req.method === 'GET' && req.url === '/api/sessions/active') {
    try {
      const sessionsRepo = new CliSessionsRepository();
      const sessions = sessionsRepo.getActive();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
    } catch (error) {
      console.error('[API] Error fetching active sessions:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch active sessions' }));
    }
    return;
  }

  // GET /api/sessions/:id - Get a single session
  const sessionMatch = req.url?.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'GET' && sessionMatch) {
    try {
      const sessionId = sessionMatch[1]!;
      const sessionsRepo = new CliSessionsRepository();
      const session = sessionsRepo.findById(sessionId);
      if (session) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(session));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
      }
    } catch (error) {
      console.error('[API] Error fetching session:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch session' }));
    }
    return;
  }

  // GET /api/sessions/:id/events - Get session events
  const eventsMatch = req.url?.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/events$/);
  if (req.method === 'GET' && eventsMatch) {
    try {
      const sessionId = eventsMatch[1]!;
      const eventsRepo = new CliEventsRepository();
      const events = eventsRepo.getBySession(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(events));
    } catch (error) {
      console.error('[API] Error fetching session events:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch session events' }));
    }
    return;
  }

  // DELETE /api/sessions - Delete all sessions
  if (req.method === 'DELETE' && req.url === '/api/sessions') {
    try {
      const sessionsRepo = new CliSessionsRepository();
      const deleted = sessionsRepo.deleteAll();
      console.log(`[API] Deleted all ${deleted} sessions`);
      // Broadcast to all connected clients
      wsBroadcast.cliAllSessionsDeleted();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted }));
    } catch (error) {
      console.error('[API] Error deleting sessions:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to delete sessions' }));
    }
    return;
  }

  // DELETE /api/sessions/:id - Delete a specific session
  const deleteSessionMatch = req.url?.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'DELETE' && deleteSessionMatch) {
    try {
      const sessionId = deleteSessionMatch[1]!;
      const sessionsRepo = new CliSessionsRepository();
      const deleted = sessionsRepo.delete(sessionId);
      if (deleted) {
        console.log(`[API] Deleted session ${sessionId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ deleted: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
      }
    } catch (error) {
      console.error('[API] Error deleting session:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to delete session' }));
    }
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Event Recording API
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /api/recording/start - Start recording events
  if (req.method === 'POST' && req.url === '/api/recording/start') {
    eventRecorder.start();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'recording', message: 'Recording started' }));
    return;
  }

  // POST /api/recording/stop - Stop recording
  if (req.method === 'POST' && req.url === '/api/recording/stop') {
    const events = eventRecorder.stop();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'stopped', eventCount: events.length }));
    return;
  }

  // GET /api/recording/status - Check recording status
  if (req.method === 'GET' && req.url === '/api/recording/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      recording: eventRecorder.recording,
      eventCount: eventRecorder.count,
    }));
    return;
  }

  // GET /api/recording/events - Get current events (without stopping)
  if (req.method === 'GET' && req.url === '/api/recording/events') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(eventRecorder.getEvents()));
    return;
  }

  // POST /api/recording/export - Export as scenario
  if (req.method === 'POST' && req.url === '/api/recording/export') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const { name, description, saveToFile } = JSON.parse(body) as {
          name: string;
          description: string;
          saveToFile?: boolean;
        };

        const scenario = eventRecorder.exportScenario(
          name || 'recorded-scenario',
          description || 'Recorded session'
        );

        // Optionally save to file
        if (saveToFile) {
          const scenariosDir = path.join(process.cwd(), '..', 'web', 'src', 'dev', 'demos', 'captured');
          if (!fs.existsSync(scenariosDir)) {
            fs.mkdirSync(scenariosDir, { recursive: true });
          }
          const filePath = path.join(scenariosDir, `${scenario.id}.json`);
          fs.writeFileSync(filePath, JSON.stringify(scenario, null, 2));
          console.log(`[Recording] Scenario saved to ${filePath}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(scenario));
      } catch (error) {
        console.error('[Recording] Export error:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
    return;
  }

  // POST /api/recording/clear - Clear events without stopping
  if (req.method === 'POST' && req.url === '/api/recording/clear') {
    eventRecorder.clear();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'cleared' }));
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Sessions API - Chat History Persistence
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/sessions/:id/messages - Get session message history
  const sessionMessagesMatch = req.url?.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/messages$/);
  if (req.method === 'GET' && sessionMessagesMatch) {
    try {
      const sessionId = sessionMessagesMatch[1]!;
      const messagesRepo = new SessionMessagesRepository();
      const messages = messagesRepo.getBySession(sessionId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages }));
    } catch (error) {
      console.error('[API] Error fetching session messages:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch session messages' }));
    }
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Prompts API
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/prompts - List all prompts
  if (req.method === 'GET' && req.url === '/api/prompts') {
    try {
      const prompts = await listPrompts();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(prompts));
    } catch (error) {
      console.error('[API] Error fetching prompts:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch prompts' }));
    }
    return;
  }

  // GET /api/prompts/:id - Get prompt config + active version content
  const promptMatch = req.url?.match(/^\/api\/prompts\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'GET' && promptMatch) {
    try {
      const promptId = promptMatch[1]!;
      const info = await getPromptInfo(promptId);
      if (!info) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Prompt not found' }));
        return;
      }
      const content = await getActivePromptRaw(promptId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...info, content }));
    } catch (error) {
      console.error('[API] Error fetching prompt:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch prompt' }));
    }
    return;
  }

  // GET /api/prompts/:id/versions - List all versions
  const promptVersionsMatch = req.url?.match(/^\/api\/prompts\/([a-zA-Z0-9_-]+)\/versions$/);
  if (req.method === 'GET' && promptVersionsMatch) {
    try {
      const promptId = promptVersionsMatch[1]!;
      const versions = await listVersions(promptId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(versions));
    } catch (error) {
      console.error('[API] Error fetching versions:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch versions' }));
    }
    return;
  }

  // GET /api/prompts/:id/versions/:version - Get specific version content
  const promptVersionMatch = req.url?.match(/^\/api\/prompts\/([a-zA-Z0-9_-]+)\/versions\/(v\d+)$/);
  if (req.method === 'GET' && promptVersionMatch) {
    try {
      const promptId = promptVersionMatch[1]!;
      const version = promptVersionMatch[2]!;
      const versionData = await getPromptVersion(promptId, version);
      if (!versionData) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Version not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(versionData));
    } catch (error) {
      console.error('[API] Error fetching version:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch version' }));
    }
    return;
  }

  // POST /api/prompts/:id - Create new version
  const createVersionMatch = req.url?.match(/^\/api\/prompts\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'POST' && createVersionMatch) {
    const promptId = createVersionMatch[1]!;
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { content } = JSON.parse(body) as { content: string };
        if (!content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Content is required' }));
          return;
        }
        const version = await createPromptVersion(promptId, content);
        console.log(`[API] Created prompt version ${version} for ${promptId}`);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version, promptId }));
      } catch (error) {
        console.error('[API] Error creating version:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create version' }));
      }
    });
    return;
  }

  // PUT /api/prompts/:id/active - Set active version
  const setActiveMatch = req.url?.match(/^\/api\/prompts\/([a-zA-Z0-9_-]+)\/active$/);
  if (req.method === 'PUT' && setActiveMatch) {
    const promptId = setActiveMatch[1]!;
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { version } = JSON.parse(body) as { version: string };
        if (!version) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Version is required' }));
          return;
        }
        await setActiveVersion(promptId, version);
        console.log(`[API] Set active version for ${promptId} to ${version}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, promptId, activeVersion: version }));
      } catch (error) {
        console.error('[API] Error setting active version:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to set active version' }));
      }
    });
    return;
  }

  // POST /api/prompts - Create new prompt
  if (req.method === 'POST' && req.url === '/api/prompts') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { id, name, description, type, content, metadata } = JSON.parse(body) as {
          id: string;
          name: string;
          description: string;
          type: 'voice' | 'subagent';
          content: string;
          metadata?: PromptConfig['metadata'];
        };

        if (!id || !name || !type || !content) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'id, name, type, and content are required' }));
          return;
        }

        await createPrompt(id, { name, description: description || '', type, metadata }, content);
        console.log(`[API] Created new prompt: ${id}`);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id }));
      } catch (error) {
        console.error('[API] Error creating prompt:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to create prompt' }));
      }
    });
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Webhooks
  // ═══════════════════════════════════════════════════════════════════════════

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

        // Mirror webhook status into session JSONL logs for replay/debugging.
        logWebhookStatus(payload.sessionId, payload.status, payload.message, payload.output);

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
