/**
 * Demo API Module - Provides streaming demo data for component development.
 *
 * Routes:
 * - GET /api/demo/health - Health check
 * - GET /api/demo/streams - List available demo streams
 * - GET /api/demo/streams/:id - SSE stream for a specific demo
 * - POST /api/demo/capture/start - Start capturing real agent output
 * - POST /api/demo/capture/stop - Stop capture and save
 * - GET /api/demo/captured - List captured sessions
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { streams, type DemoStream } from './streams/index.js';

export { type DemoStream } from './streams/index.js';

/**
 * Handle demo API requests.
 * Returns true if the request was handled, false otherwise.
 */
export async function handleDemoRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url ?? '';

  // Health check
  if (req.method === 'GET' && url === '/api/demo/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', module: 'demo' }));
    return true;
  }

  // HEAD for health check (used by frontend to check availability)
  if (req.method === 'HEAD' && url === '/api/demo/health') {
    res.writeHead(200);
    res.end();
    return true;
  }

  // List available streams
  if (req.method === 'GET' && url === '/api/demo/streams') {
    const list = Array.from(streams.entries()).map(([id, stream]) => ({
      id,
      name: stream.name,
      description: stream.description,
      agent: stream.agent,
      eventCount: stream.events.length,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(list));
    return true;
  }

  // Stream a specific demo via SSE
  const streamMatch = url.match(/^\/api\/demo\/streams\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'GET' && streamMatch) {
    const streamId = streamMatch[1]!;
    const stream = streams.get(streamId);

    if (!stream) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Stream '${streamId}' not found` }));
      return true;
    }

    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Stream events with delays
    streamEvents(res, stream);
    return true;
  }

  return false;
}

/**
 * Stream demo events via SSE with realistic timing.
 */
async function streamEvents(res: ServerResponse, stream: DemoStream): Promise<void> {
  for (const event of stream.events) {
    // Wait for the delay
    if (event.delay && event.delay > 0) {
      await sleep(event.delay);
    }

    // Check if connection is still open
    if (res.writableEnded) {
      return;
    }

    // Send the event
    const data = JSON.stringify({
      type: event.type,
      payload: event.payload,
    });
    res.write(`data: ${data}\n\n`);
  }

  // Send done event
  res.write('event: done\ndata: {}\n\n');
  res.end();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
