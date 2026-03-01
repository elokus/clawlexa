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
import type { Socket } from 'net';
import {
  CliSessionsRepository,
  CliEventsRepository,
  SessionMessagesRepository,
  HandoffsRepository,
  type Session,
  type SessionStatus,
} from '../db/index.js';
import { handleDemoRequest } from '../demo/index.js';
import { eventRecorder } from './event-recorder.js';
import { wsBroadcast } from './websocket.js';
import { clearAllSessionLogs, clearSessionLogsForSessions, logWebhookStatus } from '../logging/session-logger.js';
import * as macClient from '../tools/mac-client.js';
import {
  listPrompts,
  getPromptInfo,
  getPromptConfig,
  getPromptVersion,
  listVersions,
  createPromptVersion,
  setActiveVersion,
  createPrompt,
  updatePromptConfig,
  getActivePromptRaw,
  type PromptConfig,
} from '../prompts/index.js';
import { profiles } from '../agent/profiles.js';
import { resolveVoiceRuntimeConfig } from '../voice/config.js';
import {
  loadVoiceConfig,
  saveVoiceConfig,
  loadAuthProfiles,
  saveAuthProfiles,
  redactAuthProfiles,
  resolveApiKey,
  getVoiceConfigPath,
  getAuthProfilesPath,
} from '../voice/settings.js';
import {
  listVoices,
  getVoice,
  saveVoice,
  deleteVoice,
} from '../voice/voices.js';
import { listToolCatalog } from '../tools/catalog.js';
import {
  fetchRuntimeProviderCatalogFromAuthProfiles,
  getRuntimeConfigManifest,
  runtimeAuthKeySetToProviderMap,
  testRuntimeProviderCredentials,
  type RuntimeAuthProvider,
} from '@voiceclaw/voice-runtime';

const PORT = parseInt(process.env.WEBHOOK_PORT ?? '3000', 10);
const OPEN_ROUTER_API_KEY = process.env.OPEN_ROUTER_API_KEY ?? '';

// OpenRouter models cache
let modelsCache: { data: unknown[]; timestamp: number } | null = null;
const MODELS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
let voiceCatalogCache: { data: unknown; timestamp: number } | null = null;
const VOICE_CATALOG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface WebhookPayload {
  sessionId: string;
  status: 'running' | 'waiting_for_input' | 'finished' | 'error';
  message?: string;
  output?: string[];
}

type WebhookHandler = (payload: WebhookPayload) => Promise<void>;

let webhookHandler: WebhookHandler | null = null;
let server: http.Server | null = null;
const openConnections = new Set<Socket>();

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

async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve((body ? JSON.parse(body) : {}) as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function maskKey(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function resolveLocalInferenceEndpoint(): string {
  const envEndpoint = process.env.LOCAL_INFERENCE_ENDPOINT?.trim();
  if (envEndpoint) return envEndpoint;

  try {
    const config = loadVoiceConfig();
    const providerSettings = config.voice.providerSettings;
    const decomposedSettings = providerSettings?.decomposed;
    const configuredEndpoint = decomposedSettings?.localEndpoint;
    if (typeof configuredEndpoint === 'string' && configuredEndpoint.trim().length > 0) {
      return configuredEndpoint.trim();
    }
  } catch {
    // Non-fatal: fall back to default local-inference endpoint.
  }

  return 'http://localhost:1060';
}

async function proxyLocalInferenceJson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstreamPath: string
): Promise<void> {
  try {
    const endpoint = new URL(upstreamPath, resolveLocalInferenceEndpoint());
    const method = req.method ?? 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const payload = hasBody
      ? await readJsonBody<Record<string, unknown>>(req)
      : undefined;

    const upstream = await fetch(endpoint, {
      method,
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(payload ?? {}) : undefined,
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    });
    res.end(text);
  } catch (error) {
    console.error(`[API] Local inference proxy error (${upstreamPath}):`, error);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `Failed to reach local inference endpoint (${resolveLocalInferenceEndpoint()})`,
      })
    );
  }
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
      const handoffsRepo = new HandoffsRepository();

      const activeStatuses: SessionStatus[] = ['pending', 'running', 'waiting_for_input'];
      const sessions = sessionsRepo.list();
      const activeTerminalSessions = sessions.filter(
        (session) =>
          activeStatuses.includes(session.status) &&
          (session.type === 'terminal' || session.mac_session_id !== null)
      );

      let terminatedPtySessions = 0;
      const terminationErrors: string[] = [];

      // Best-effort PTY termination before DB cleanup.
      for (const session of activeTerminalSessions) {
        try {
          const result = await macClient.terminateSession(session.id);
          if (result.success) {
            terminatedPtySessions += 1;
          } else {
            terminationErrors.push(`${session.id.slice(0, 8)}: ${result.message}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          terminationErrors.push(`${session.id.slice(0, 8)}: ${message}`);
        }
      }

      // Remove handoff packets first to avoid FK violations on cli_sessions.
      const deletedHandoffs = handoffsRepo.deleteAll();
      const deleted = sessionsRepo.deleteAll();
      const deletedLogs = clearAllSessionLogs();

      if (terminationErrors.length > 0) {
        console.warn('[API] PTY termination warnings:', terminationErrors);
      }

      console.log(
        `[API] Cleared ${deleted} sessions, ${deletedHandoffs} handoffs, ${deletedLogs} session logs, terminated ${terminatedPtySessions} PTY sessions`
      );

      // Broadcast to all connected clients
      wsBroadcast.cliAllSessionsDeleted();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        deleted,
        deletedHandoffs,
        deletedLogs,
        terminatedPtySessions,
        terminationErrors,
      }));
    } catch (error) {
      console.error('[API] Error deleting sessions:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to delete sessions' }));
    }
    return;
  }

  // DELETE /api/sessions/:id/tree - Delete a thread tree (root + descendants)
  const deleteTreeMatch = req.url?.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/tree$/);
  if (req.method === 'DELETE' && deleteTreeMatch) {
    try {
      const rootId = deleteTreeMatch[1]!;
      const sessionsRepo = new CliSessionsRepository();
      const rootSession = sessionsRepo.findById(rootId);

      if (!rootSession) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      const treeIds = sessionsRepo.getTreeSessionIds(rootId);
      const treeSessions: Session[] = treeIds
        .map((id) => sessionsRepo.findById(id))
        .filter((session): session is Session => session !== null);

      const activeStatuses: SessionStatus[] = ['pending', 'running', 'waiting_for_input'];
      const activeTerminalSessions = treeSessions.filter(
        (session) =>
          activeStatuses.includes(session.status) &&
          (session.type === 'terminal' || session.mac_session_id !== null)
      );

      let terminatedPtySessions = 0;
      const terminationErrors: string[] = [];

      // Best-effort PTY termination before DB cleanup.
      for (const session of activeTerminalSessions) {
        try {
          const result = await macClient.terminateSession(session.id);
          if (result.success) {
            terminatedPtySessions += 1;
          } else {
            terminationErrors.push(`${session.id.slice(0, 8)}: ${result.message}`);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          terminationErrors.push(`${session.id.slice(0, 8)}: ${message}`);
        }
      }

      const deletedLogs = clearSessionLogsForSessions(
        treeSessions.map((session) => ({ id: session.id, name: session.name }))
      );
      const deletedSessionIds = sessionsRepo.deleteTree(rootId);

      if (terminationErrors.length > 0) {
        console.warn('[API] PTY termination warnings (tree delete):', terminationErrors);
      }

      console.log(
        `[API] Deleted tree ${rootId}: ${deletedSessionIds.length} sessions, ${deletedLogs} logs, terminated ${terminatedPtySessions} PTY sessions`
      );

      // Remove deleted sessions from in-memory client stores.
      for (const deletedId of deletedSessionIds) {
        wsBroadcast.cliSessionDeleted(deletedId);
      }

      // Refresh tree list for all clients.
      wsBroadcast.allActiveTreesUpdate();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        deleted: deletedSessionIds.length,
        deletedSessionIds,
        deletedLogs,
        terminatedPtySessions,
        terminationErrors,
      }));
    } catch (error) {
      console.error('[API] Error deleting session tree:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to delete session tree' }));
    }
    return;
  }

  // DELETE /api/sessions/:id - Delete a specific session
  const deleteSessionMatch = req.url?.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'DELETE' && deleteSessionMatch) {
    try {
      const sessionId = deleteSessionMatch[1]!;
      const sessionsRepo = new CliSessionsRepository();
      const handoffsRepo = new HandoffsRepository();
      const session = sessionsRepo.findById(sessionId);

      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      let terminatedPtySession = false;
      let terminationError: string | null = null;
      const isActive = ['pending', 'running', 'waiting_for_input'].includes(session.status);
      const isTerminalSession = session.type === 'terminal' || session.mac_session_id !== null;

      // Best-effort PTY termination before deleting the DB row.
      if (isActive && isTerminalSession) {
        try {
          const result = await macClient.terminateSession(sessionId);
          terminatedPtySession = result.success;
          if (!result.success) {
            terminationError = result.message;
          }
        } catch (error) {
          terminationError = error instanceof Error ? error.message : String(error);
        }
      }

      const deletedHandoffs = handoffsRepo.deleteBySession(sessionId);
      const deleted = sessionsRepo.delete(sessionId);

      if (deleted) {
        console.log(
          `[API] Deleted session ${sessionId} (handoffs: ${deletedHandoffs}, terminatedPty: ${terminatedPtySession})`
        );
        wsBroadcast.cliSessionDeleted(sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          deleted: true,
          deletedHandoffs,
          terminatedPtySession,
          terminationError,
        }));
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
          const scenariosDir = path.join(process.cwd(), '..', 'web-ui', 'src', 'dev', 'demos', 'captured');
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
  // Models API (OpenRouter proxy with cache)
  // ═══════════════════════════════════════════════════════════════════════════

  if (req.method === 'GET' && req.url === '/api/models') {
    try {
      const now = Date.now();
      if (!modelsCache || now - modelsCache.timestamp > MODELS_CACHE_TTL) {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
          headers: {
            'Authorization': `Bearer ${OPEN_ROUTER_API_KEY}`,
          },
        });
        if (!response.ok) {
          throw new Error(`OpenRouter API error: ${response.status}`);
        }
        const json = await response.json() as { data: Array<{ id: string; name: string; context_length: number; pricing: { prompt: string; completion: string } }> };
        // Trim to essential fields and sort by id
        const models = json.data
          .map((m) => ({
            id: m.id,
            name: m.name,
            context_length: m.context_length,
            pricing: m.pricing,
          }))
          .sort((a, b) => a.id.localeCompare(b.id));
        modelsCache = { data: models, timestamp: now };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(modelsCache.data));
    } catch (error) {
      console.error('[API] Error fetching models:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch models' }));
    }
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Local Inference Control Plane Proxy
  // ═══════════════════════════════════════════════════════════════════════════

  if (req.method === 'GET' && req.url === '/api/local-inference/health') {
    await proxyLocalInferenceJson(req, res, '/health');
    return;
  }

  if (req.method === 'GET' && req.url === '/api/local-inference/models/catalog') {
    await proxyLocalInferenceJson(req, res, '/v1/models/catalog');
    return;
  }

  if (req.method === 'GET' && req.url === '/api/local-inference/models/state') {
    await proxyLocalInferenceJson(req, res, '/v1/models/state');
    return;
  }

  if (req.method === 'GET' && req.url === '/api/local-inference/models/suggestions') {
    await proxyLocalInferenceJson(req, res, '/v1/models/suggestions');
    return;
  }

  if (req.method === 'POST' && req.url === '/api/local-inference/models/download') {
    await proxyLocalInferenceJson(req, res, '/v1/models/download');
    return;
  }

  if (req.method === 'POST' && req.url === '/api/local-inference/models/load') {
    await proxyLocalInferenceJson(req, res, '/v1/models/load');
    return;
  }

  if (req.method === 'POST' && req.url === '/api/local-inference/playground/tts/benchmark') {
    await proxyLocalInferenceJson(req, res, '/v1/playground/tts/benchmark');
    return;
  }

  if (req.method === 'POST' && req.url === '/api/local-inference/playground/tts/speech') {
    try {
      const payload = await readJsonBody<Record<string, unknown>>(req);
      const endpoint = new URL('/v1/audio/speech', resolveLocalInferenceEndpoint());
      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!upstream.ok) {
        const errorText = await upstream.text();
        res.writeHead(upstream.status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: errorText || `Local inference speech failed (${upstream.status})`,
          })
        );
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.writeHead(200, {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Content-Length': String(buffer.byteLength),
        ...(upstream.headers.get('x-audio-sample-rate')
          ? { 'x-audio-sample-rate': upstream.headers.get('x-audio-sample-rate')! }
          : {}),
        ...(upstream.headers.get('x-audio-format')
          ? { 'x-audio-format': upstream.headers.get('x-audio-format')! }
          : {}),
      });
      res.end(buffer);
    } catch (error) {
      console.error('[API] Local inference speech proxy error:', error);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to synthesize local TTS sample' }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/config/voice/catalog') {
    try {
      const now = Date.now();
      if (!voiceCatalogCache || now - voiceCatalogCache.timestamp > VOICE_CATALOG_CACHE_TTL) {
        const authProfiles = loadAuthProfiles();
        const runtimeCatalog = await fetchRuntimeProviderCatalogFromAuthProfiles({
          authProfiles,
          env: process.env,
        });

        const manifest = getRuntimeConfigManifest();
        // Auth profile names for dropdown selectors
        const authProfileNames = Object.keys(authProfiles.profiles);

        voiceCatalogCache = {
          data: {
            manifest,
            providerCatalog: runtimeCatalog.entries,
            providerSchemas: runtimeCatalog.providerSchemas,
            authProfileNames,
          },
          timestamp: now,
        };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(voiceCatalogCache.data));
    } catch (error) {
      console.error('[API] Error fetching voice catalog:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch voice catalog' }));
    }
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Voice Config API (JSON-backed runtime config + auth profiles)
  // ═══════════════════════════════════════════════════════════════════════════

  if (req.method === 'GET' && req.url?.startsWith('/api/config/voice/effective')) {
    try {
      const requestUrl = new URL(req.url, 'http://localhost');
      const profileName = (requestUrl.searchParams.get('profile') ?? '').toLowerCase();

      const profile = profiles[profileName] ?? profiles[`hey_${profileName}`];
      if (!profile) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown profile. Use profile=jarvis|marvin|computer|hey_jarvis' }));
        return;
      }

      const runtime = resolveVoiceRuntimeConfig(profile);
      const auth = runtimeAuthKeySetToProviderMap(runtime.auth);
      const redactedAuth = Object.fromEntries(
        Object.entries(auth).map(([provider, key]) => [provider, maskKey(key)])
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          profile: profile.name,
          mode: runtime.mode,
          provider: runtime.provider,
          language: runtime.language,
          voice: runtime.voice,
          model: runtime.model,
          decomposed: {
            stt: `${runtime.decomposedSttProvider}/${runtime.decomposedSttModel}`,
            llm: `${runtime.decomposedLlmProvider}/${runtime.decomposedLlmModel}`,
            tts: `${runtime.decomposedTtsProvider}/${runtime.decomposedTtsModel}`,
          },
          auth: redactedAuth,
          turn: runtime.turn,
        })
      );
    } catch (error) {
      console.error('[API] Error resolving effective voice config:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to resolve effective voice config' }));
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/config/voice') {
    try {
      const voiceConfig = loadVoiceConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: getVoiceConfigPath(), config: voiceConfig }));
    } catch (error) {
      console.error('[API] Error loading voice config:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to load voice config' }));
    }
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/config/voice') {
    try {
      const body = await readJsonBody<{ config: unknown }>(req);
      const next = saveVoiceConfig(body.config as never);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: getVoiceConfigPath(), config: next }));
    } catch (error) {
      console.error('[API] Error saving voice config:', error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return;
  }

  if (req.method === 'GET' && req.url?.startsWith('/api/config/auth-profiles')) {
    try {
      const requestUrl = new URL(req.url, 'http://localhost');
      const redacted = requestUrl.searchParams.get('redacted') === 'true';
      const authProfiles = loadAuthProfiles();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          path: getAuthProfilesPath(),
          config: redacted ? redactAuthProfiles(authProfiles) : authProfiles,
        })
      );
    } catch (error) {
      console.error('[API] Error loading auth profiles:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to load auth profiles' }));
    }
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/config/auth-profiles') {
    try {
      const body = await readJsonBody<{ config: unknown }>(req);
      const next = saveAuthProfiles(body.config as never);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: getAuthProfilesPath(), config: redactAuthProfiles(next) }));
    } catch (error) {
      console.error('[API] Error saving auth profiles:', error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/config/auth-profiles/test') {
    try {
      const body = await readJsonBody<{
        provider?: RuntimeAuthProvider;
        authProfileId?: string;
      }>(req);

      const authProfiles = loadAuthProfiles();

      let provider = body.provider;
      if (!provider && body.authProfileId) {
        provider = authProfiles.profiles[body.authProfileId]?.provider;
      }

      if (!provider) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'provider or authProfileId is required' }));
        return;
      }

      const apiKey = resolveApiKey(provider, {
        authProfileId: body.authProfileId,
        authProfiles,
      });

      if (!apiKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No API key resolved for provider: ${provider}` }));
        return;
      }

      const result = await testRuntimeProviderCredentials(provider, apiKey);
      res.writeHead(result.ok ? 200 : 502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ provider, ...result }));
    } catch (error) {
      console.error('[API] Error testing auth profile:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Voices API — Voice Library (provider-agnostic clone references)
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/config/voices - List all voice references
  if (req.method === 'GET' && req.url === '/api/config/voices') {
    try {
      const voices = listVoices();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ voices }));
    } catch (error) {
      console.error('[API] Error listing voices:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return;
  }

  // POST /api/config/voices - Create voice from uploaded WAV + metadata
  if (req.method === 'POST' && req.url === '/api/config/voices') {
    try {
      const body = await readJsonBody<{
        label: string;
        refText: string;
        language: string;
        instruct?: string;
        model?: string;
        seed?: number;
        wavBase64: string;
      }>(req);

      if (!body.label || !body.refText || !body.wavBase64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'label, refText, and wavBase64 are required' }));
        return;
      }

      const wavBuffer = Buffer.from(body.wavBase64, 'base64');
      const meta = saveVoice(body.label, {
        refText: body.refText,
        language: body.language || 'English',
        instruct: body.instruct,
        model: body.model,
        seed: body.seed,
      }, wavBuffer);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ voice: meta }));
    } catch (error) {
      console.error('[API] Error creating voice:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return;
  }

  // DELETE /api/config/voices/:label - Delete a voice reference
  const voiceDeleteMatch = req.url?.match(/^\/api\/config\/voices\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'DELETE' && voiceDeleteMatch) {
    try {
      const label = voiceDeleteMatch[1]!;
      const deleted = deleteVoice(label);
      if (!deleted) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Voice not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ deleted: label }));
    } catch (error) {
      console.error('[API] Error deleting voice:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return;
  }

  // GET /api/config/voices/:label/audio - Serve the reference WAV
  const voiceAudioMatch = req.url?.match(/^\/api\/config\/voices\/([a-zA-Z0-9_-]+)\/audio$/);
  if (req.method === 'GET' && voiceAudioMatch) {
    try {
      const label = voiceAudioMatch[1]!;
      const entry = getVoice(label);
      if (!entry) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Voice not found' }));
        return;
      }
      const wavData = fs.readFileSync(entry.refAudioPath);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': String(wavData.length),
      });
      res.end(wavData);
    } catch (error) {
      console.error('[API] Error serving voice audio:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
    return;
  }

  // POST /api/config/voices/design - Generate voice via VoiceDesign model
  if (req.method === 'POST' && req.url === '/api/config/voices/design') {
    try {
      const body = await readJsonBody<{
        label: string;
        instruct: string;
        text: string;
        language?: string;
        seed?: number;
        temperature?: number;
        model?: string;
        localEndpoint?: string;
      }>(req);

      if (!body.label || !body.instruct || !body.text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'label, instruct, and text are required' }));
        return;
      }

      const endpoint = body.localEndpoint || process.env.LOCAL_INFERENCE_URL || 'http://localhost:1060';
      const designResponse = await fetch(`${endpoint}/v1/voice/design`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruct: body.instruct,
          text: body.text,
          language: body.language || 'English',
          seed: body.seed ?? 42,
          temperature: body.temperature ?? 0.7,
          model: body.model,
        }),
      });

      if (!designResponse.ok) {
        const errText = await designResponse.text();
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Voice design failed: ${errText}` }));
        return;
      }

      const wavBuffer = Buffer.from(await designResponse.arrayBuffer());
      const meta = saveVoice(body.label, {
        refText: body.text,
        language: body.language || 'English',
        instruct: body.instruct,
        model: body.model || 'qwen3-1.7b-vd-4bit',
        seed: body.seed ?? 42,
      }, wavBuffer);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ voice: meta }));
    } catch (error) {
      console.error('[API] Error designing voice:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
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

  // GET /api/prompts/catalog - Prompt settings catalog (wake words + tools)
  if (req.method === 'GET' && req.url === '/api/prompts/catalog') {
    try {
      const wakeWords = Array.from(
        new Set(
          Object.values(profiles)
            .map((profile) => profile.wakeWord)
            .filter((value) => typeof value === 'string' && value.trim().length > 0)
        )
      ).sort((a, b) => a.localeCompare(b));

      const tools = await listToolCatalog();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ wakeWords, tools }));
    } catch (error) {
      console.error('[API] Error fetching prompt catalog:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to fetch prompt catalog' }));
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

  // PUT /api/prompts/:id/metadata - Update prompt metadata (model, maxSteps, etc.)
  const metadataMatch = req.url?.match(/^\/api\/prompts\/([a-zA-Z0-9_-]+)\/metadata$/);
  if (req.method === 'PUT' && metadataMatch) {
    const promptId = metadataMatch[1]!;
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { metadata } = JSON.parse(body) as { metadata: PromptConfig['metadata'] };
        if (!metadata) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'metadata is required' }));
          return;
        }
        // Merge with existing metadata
        const existing = await getPromptConfig(promptId);
        if (!existing) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Prompt not found' }));
          return;
        }
        const mergedMetadata = { ...existing.metadata, ...metadata };
        await updatePromptConfig(promptId, { metadata: mergedMetadata });
        console.log(`[API] Updated metadata for ${promptId}:`, mergedMetadata);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, promptId, metadata: mergedMetadata }));
      } catch (error) {
        console.error('[API] Error updating metadata:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update metadata' }));
      }
    });
    return;
  }

  // PUT /api/prompts/:id/name - Update prompt display name
  const nameMatch = req.url?.match(/^\/api\/prompts\/([a-zA-Z0-9_-]+)\/name$/);
  if (req.method === 'PUT' && nameMatch) {
    const promptId = nameMatch[1]!;
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { name } = JSON.parse(body) as { name?: string };
        const trimmedName = typeof name === 'string' ? name.trim() : '';
        if (!trimmedName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'name is required' }));
          return;
        }

        await updatePromptConfig(promptId, { name: trimmedName });
        console.log(`[API] Updated name for ${promptId}: ${trimmedName}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, promptId, name: trimmedName }));
      } catch (error) {
        console.error('[API] Error updating prompt name:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to update prompt name' }));
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
    openConnections.clear();

    server.on('connection', (socket) => {
      openConnections.add(socket);
      socket.on('close', () => {
        openConnections.delete(socket);
      });
    });

    server.on('error', (err) => {
      console.error('[Webhook] Server error:', err);
      server = null;
      openConnections.clear();
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
      console.warn('[Webhook] Force shutdown after close timeout');
      finish();
    }, 2000);

    try {
      currentServer.close(() => {
        clearTimeout(timeout);
        console.log('[Webhook] Server stopped');
        finish();
      });
    } catch (error) {
      clearTimeout(timeout);
      console.warn('[Webhook] Error while closing server:', error);
      finish();
    }
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
