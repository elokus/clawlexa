// Configuration for web dashboard

// Mac daemon URL for PTY terminal WebSocket connections
// In development, this connects directly to the Mac daemon
// In production, set via VITE_MAC_DAEMON_URL environment variable
export const MAC_DAEMON_URL = import.meta.env.VITE_MAC_DAEMON_URL || 'localhost:3100';

// Pi-agent API URL for session metadata
// Uses Vite proxy in development, explicit URL in production
export const API_URL = import.meta.env.VITE_API_URL || '';

// WebSocket URL for pi-agent events
export const WS_URL = import.meta.env.VITE_WS_URL || '';

// Demo mode flag
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// Helper to get Mac daemon WebSocket URL for a session
export function getMacDaemonTerminalUrl(sessionId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${MAC_DAEMON_URL}/sessions/${sessionId}/terminal`;
}
