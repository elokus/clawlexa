// ═══════════════════════════════════════════════════════════════════════════
// WebSocket Hook - Real-time connection to voice-agent
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { useUnifiedSessionsStore, handleWebSocketMessage } from '../stores';
import type { WSMessage } from '../types';

// Determine WebSocket URL based on environment
const getWsUrl = () => {
  // If demo mode is explicitly enabled, return null
  if (process.env.PUBLIC_DEMO_MODE === 'true') return null;

  // In development mode, use the dev server proxy to avoid cross-origin issues
  // The proxy at /ws forwards to the Pi's WebSocket server
  if (process.env.NODE_ENV !== 'production') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  // If explicit URL is set (production), use it
  const envUrl = process.env.PUBLIC_WS_URL;
  if (envUrl) return envUrl;

  // In production build served from Pi, use same host with port 3001
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  return `${protocol}//${host}:3001`;
};

const WS_URL = getWsUrl();
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;
const DEMO_MODE = !WS_URL;

// Module-level singleton to prevent duplicate connections across React StrictMode remounts
let globalWs: WebSocket | null = null;
let globalWsRefCount = 0;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCleaningUpRef = useRef(false);
  const isConnectingRef = useRef(false);

  // Get stable references from unified store
  const setWsError = useUnifiedSessionsStore((s) => s.setWsError);

  // Use unified message handler directly (legacy stores deleted)
  const handleMessage = handleWebSocketMessage;

  useEffect(() => {
    // Skip WebSocket connection in demo mode
    if (DEMO_MODE) {
      console.log('[WS] Demo mode - skipping WebSocket connection');
      return;
    }

    // Increment ref count for this hook instance
    globalWsRefCount++;

    // Reset cleanup flag on mount (important for React Strict Mode double-mount)
    isCleaningUpRef.current = false;

    const connect = () => {
      // Prevent multiple simultaneous connection attempts
      if (isConnectingRef.current || isCleaningUpRef.current) {
        console.log(`[WS] Skipping connect: connecting=${isConnectingRef.current}, cleaning=${isCleaningUpRef.current}`);
        return;
      }

      // Reuse existing global connection if available and open
      if (globalWs?.readyState === WebSocket.OPEN) {
        console.log('[WS] Reusing existing connection');
        wsRef.current = globalWs;
        // Connection state is tracked via clientId from 'welcome' message
        return;
      }

      // Also check if globalWs is CONNECTING (still establishing)
      if (globalWs?.readyState === WebSocket.CONNECTING) {
        console.log('[WS] Connection in progress, waiting...');
        wsRef.current = globalWs;
        // The onopen handler will set connected when ready
        return;
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        return;
      }

      // Close any existing connection first
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (globalWs) {
        globalWs.close();
        globalWs = null;
      }

      try {
        isConnectingRef.current = true;
        console.log(`[WS] Connecting to ${WS_URL}...`);
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          console.log('[WS] Connected, readyState:', ws.readyState);
          isConnectingRef.current = false;
          globalWs = ws; // Store in global singleton
          wsRef.current = ws; // Ensure local ref is also set
          // Connection state tracked via 'welcome' message which sets clientId
          setWsError(null);
          reconnectAttemptsRef.current = 0;
        };

        ws.binaryType = 'arraybuffer';

        ws.onmessage = (event) => {
          // Handle binary audio data
          if (event.data instanceof ArrayBuffer) {
            // Dispatch custom event for audio playback
            window.dispatchEvent(new CustomEvent('ws-audio', { detail: event.data }));
            return;
          }

          try {
            const msg: WSMessage = JSON.parse(event.data);
            handleMessage(msg);
          } catch (err) {
            console.error('[WS] Failed to parse message:', err);
          }
        };

        ws.onerror = (event) => {
          console.error('[WS] Error:', event);
          isConnectingRef.current = false;
          setWsError('WebSocket connection error');
        };

        ws.onclose = (event) => {
          console.log(`[WS] Disconnected (code: ${event.code}, reason: ${event.reason || 'none'}, wasClean: ${event.wasClean})`);
          isConnectingRef.current = false;
          // Reset connection state - clientId null means disconnected
          useUnifiedSessionsStore.getState().setClientIdentity(null, false);
          wsRef.current = null;
          globalWs = null;

          // Don't reconnect if we're cleaning up
          if (isCleaningUpRef.current) {
            return;
          }

          // Attempt reconnect for disconnections
          if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttemptsRef.current++;
            const delay = RECONNECT_DELAY * Math.min(reconnectAttemptsRef.current, 5);
            console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
            reconnectTimeoutRef.current = setTimeout(connect, delay);
          } else {
            setWsError('Max reconnection attempts reached');
          }
        };

        wsRef.current = ws;
        globalWs = ws;
      } catch (err) {
        console.error('[WS] Connection error:', err);
        isConnectingRef.current = false;
        setWsError('Failed to connect');
      }
    };

    // Initial connection
    connect();

    // Cleanup on unmount
    return () => {
      globalWsRefCount--;
      isCleaningUpRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Delay socket close to handle React StrictMode double-mount
      // StrictMode unmounts then immediately remounts, so we wait briefly
      // to see if a remount happens before actually closing the socket
      const socketToClose = wsRef.current;
      wsRef.current = null;

      setTimeout(() => {
        // Only close if still at 0 refs after delay (no remount happened)
        if (globalWsRefCount === 0 && socketToClose && socketToClose === globalWs) {
          console.log('[WS] Closing socket (no remount after 500ms)');
          socketToClose.close();
          globalWs = null;
          // Reset connection state
          useUnifiedSessionsStore.getState().setClientIdentity(null, false);
        }
      }, 500); // Increased delay for better StrictMode handling
    };
  }, []); // Empty dependency array - only run on mount/unmount

  const send = (type: string, payload: unknown) => {
    // Use globalWs as authoritative source (handles StrictMode race conditions)
    const ws = wsRef.current ?? globalWs;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('[WS] Cannot send - not connected', {
        wsRef: wsRef.current?.readyState,
        globalWs: globalWs?.readyState,
      });
    }
  };

  const sendBinary = (data: ArrayBuffer) => {
    // Use globalWs as authoritative source (handles StrictMode race conditions)
    const ws = wsRef.current ?? globalWs;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  };

  const getSocket = () => wsRef.current;

  const disconnect = () => {
    isCleaningUpRef.current = true;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    // Reset connection state
    useUnifiedSessionsStore.getState().setClientIdentity(null, false);
  };

  const reconnect = () => {
    isCleaningUpRef.current = false;
    reconnectAttemptsRef.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  /**
   * Request to become the Master client (audio I/O controller).
   * Will be denied if agent is currently thinking/speaking.
   */
  const requestMaster = () => {
    send('request_master', {});
  };

  /**
   * Notify backend which session the client is focused on.
   * Used for routing text input to the correct subagent.
   */
  const sendFocusSession = (sessionId: string | null) => {
    send('focus_session', { sessionId });
  };

  /**
   * Send text input to the currently focused session.
   * Backend routes to the appropriate subagent handler.
   */
  const sendSessionInput = (text: string) => {
    send('session_input', { text });
  };

  return { disconnect, send, sendBinary, getSocket, reconnect, requestMaster, sendFocusSession, sendSessionInput };
}
