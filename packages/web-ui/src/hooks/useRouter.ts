/**
 * Simple Router Hook - URL-based navigation without external dependencies
 *
 * Supports:
 * - /session/:sessionId - Focus a specific session
 * - / - Home (default view)
 * - /dev - Dev page
 */

import { useState, useEffect, useRef } from 'react';

export interface RouteParams {
  sessionId?: string;
}

export interface RouterState {
  path: string;
  params: RouteParams;
}

/**
 * Parse the current URL path and extract route parameters.
 */
function parseRoute(pathname: string): RouterState {
  const params: RouteParams = {};

  // Match /session/:sessionId
  const sessionMatch = pathname.match(/^\/session\/([a-zA-Z0-9_-]+)\/?$/);
  if (sessionMatch) {
    params.sessionId = sessionMatch[1];
    return { path: '/session/:sessionId', params };
  }

  // Match /dev
  if (pathname === '/dev' || pathname === '/dev/') {
    return { path: '/dev', params };
  }

  // Default to home
  return { path: '/', params };
}

/**
 * Navigate to a new URL path.
 */
export function navigate(path: string, replace = false): void {
  // Skip if already at this path - prevents unnecessary state updates
  if (window.location.pathname === path) {
    console.log(`[Router] Already at ${path}, skipping navigation`);
    return;
  }

  if (replace) {
    window.history.replaceState(null, '', path);
  } else {
    window.history.pushState(null, '', path);
  }
  // Dispatch popstate event so listeners update
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Navigate to a specific session.
 */
export function navigateToSession(sessionId: string | null, replace = false): void {
  if (sessionId) {
    navigate(`/session/${sessionId}`, replace);
  } else {
    navigate('/', replace);
  }
}

/**
 * Hook to get current route state and listen for changes.
 */
export function useRouter(): RouterState {
  const [state, setState] = useState<RouterState>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const handlePopState = () => {
      setState(parseRoute(window.location.pathname));
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  return state;
}

/**
 * Hook to get the session ID from URL (convenience wrapper).
 */
export function useSessionIdFromUrl(): string | null {
  const { params } = useRouter();
  return params.sessionId ?? null;
}

/**
 * Hook to sync focusedSessionId with URL.
 * - When URL changes → update store (primary direction)
 * - When store changes programmatically → update URL (secondary)
 */
export function useUrlSessionSync(
  focusedSessionId: string | null,
  focusSession: (id: string) => void
): void {
  const { params } = useRouter();
  const urlSessionId = params.sessionId ?? null;

  // Use ref for focusSession to avoid it being an effect dependency
  const focusSessionRef = useRef(focusSession);
  focusSessionRef.current = focusSession;

  // Track previous values to detect which one changed
  const prevUrlRef = useRef<string | null>(null);
  const prevFocusRef = useRef<string | null>(null);

  useEffect(() => {
    const urlChanged = urlSessionId !== prevUrlRef.current;
    const focusChanged = focusedSessionId !== prevFocusRef.current;

    // Update refs for next render
    prevUrlRef.current = urlSessionId;
    prevFocusRef.current = focusedSessionId;

    // Already in sync - nothing to do
    if (urlSessionId === focusedSessionId) {
      return;
    }

    // URL changed (user navigation) → sync to store
    if (urlChanged && urlSessionId) {
      console.log(`[Router] URL→Store: ${urlSessionId.slice(0, 8)}`);
      focusSessionRef.current(urlSessionId);
      return;
    }

    // Focus changed (programmatic) → sync to URL
    if (focusChanged) {
      if (focusedSessionId) {
        console.log(`[Router] Store→URL: ${focusedSessionId.slice(0, 8)}`);
        navigateToSession(focusedSessionId, true);
      } else if (urlSessionId) {
        console.log(`[Router] Store→URL: clearing to /`);
        navigate('/', true);
      }
      return;
    }

    // Neither changed but they differ - URL takes precedence (initial load case)
    if (urlSessionId) {
      console.log(`[Router] Initial sync URL→Store: ${urlSessionId.slice(0, 8)}`);
      focusSessionRef.current(urlSessionId);
    }
  }, [urlSessionId, focusedSessionId]);
}
