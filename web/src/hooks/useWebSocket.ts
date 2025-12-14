// ═══════════════════════════════════════════════════════════════════════════
// WebSocket Hook - Real-time connection to pi-agent
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { useAgentStore } from '../stores/agent';
import type { WSMessage } from '../types';

// Determine WebSocket URL based on environment
const getWsUrl = () => {
  // If demo mode is explicitly enabled, return null
  if (import.meta.env.VITE_DEMO_MODE === 'true') return null;

  // In development mode, use the Vite proxy to avoid cross-origin issues
  // The proxy at /ws forwards to the Pi's WebSocket server
  if (import.meta.env.DEV) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  }

  // If explicit URL is set (production), use it
  const envUrl = import.meta.env.VITE_WS_URL;
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

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCleaningUpRef = useRef(false);
  const isConnectingRef = useRef(false);

  // Get stable references from store
  const setConnected = useAgentStore((s) => s.setConnected);
  const setWsError = useAgentStore((s) => s.setWsError);
  const handleMessage = useAgentStore((s) => s.handleMessage);

  useEffect(() => {
    // Skip WebSocket connection in demo mode
    if (DEMO_MODE) {
      console.log('[WS] Demo mode - skipping WebSocket connection');
      return;
    }

    // Reset cleanup flag on mount (important for React Strict Mode double-mount)
    isCleaningUpRef.current = false;

    const connect = () => {
      // Prevent multiple simultaneous connection attempts
      if (isConnectingRef.current || isCleaningUpRef.current) {
        console.log(`[WS] Skipping connect: connecting=${isConnectingRef.current}, cleaning=${isCleaningUpRef.current}`);
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

      try {
        isConnectingRef.current = true;
        console.log(`[WS] Connecting to ${WS_URL}...`);
        const ws = new WebSocket(WS_URL);

        ws.onopen = () => {
          console.log('[WS] Connected');
          isConnectingRef.current = false;
          setConnected(true);
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
          console.log(`[WS] Disconnected (code: ${event.code}, reason: ${event.reason})`);
          isConnectingRef.current = false;
          setConnected(false);
          wsRef.current = null;

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
      isCleaningUpRef.current = true;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setConnected(false);
    };
  }, []); // Empty dependency array - only run on mount/unmount

  const send = (type: string, payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, payload }));
    } else {
      console.warn('[WS] Cannot send - not connected');
    }
  };

  const sendBinary = (data: ArrayBuffer) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
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
    setConnected(false);
  };

  const reconnect = () => {
    isCleaningUpRef.current = false;
    reconnectAttemptsRef.current = 0;
    if (wsRef.current) {
      wsRef.current.close();
    }
  };

  return { disconnect, send, sendBinary, getSocket, reconnect };
}
