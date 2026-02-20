// Configuration for web dashboard

// Mac daemon URL for PTY terminal WebSocket connections
// In development, this connects directly to the Mac daemon
// In production, set via PUBLIC_MAC_DAEMON_URL environment variable
export const MAC_DAEMON_URL = process.env.PUBLIC_MAC_DAEMON_URL || 'localhost:3100';

// Voice-agent API URL for session metadata
// Uses dev server proxy in development, explicit URL in production
export const API_URL = process.env.PUBLIC_API_URL || '';

// WebSocket URL for voice-agent events
export const WS_URL = process.env.PUBLIC_WS_URL || '';

// Demo mode flag
export const DEMO_MODE = process.env.PUBLIC_DEMO_MODE === 'true';

// Helper to get Mac daemon WebSocket URL for a session
export function getMacDaemonTerminalUrl(sessionId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${MAC_DAEMON_URL}/sessions/${sessionId}/terminal`;
}
