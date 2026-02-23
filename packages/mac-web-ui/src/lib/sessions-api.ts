/**
 * Sessions API Client
 *
 * API client for fetching session message history.
 * Used to reconstruct chat conversations after page refresh.
 */

const API_BASE = process.env.PUBLIC_API_URL || '';

/**
 * Stored session message (AI SDK event)
 */
export interface SessionMessage {
  id: number;
  session_id: string;
  event_type: string;
  payload: string; // JSON blob of AISDKStreamEvent
  created_at: string;
}

/**
 * Response from GET /api/sessions/:id/messages
 */
export interface SessionMessagesResponse {
  messages: SessionMessage[];
}

/**
 * Fetch all messages for a session.
 * Returns stored AI SDK events that can be replayed to reconstruct the UI.
 *
 * @param sessionId - The session ID to fetch messages for
 * @returns Array of stored message events
 */
export async function fetchSessionMessages(sessionId: string): Promise<SessionMessage[]> {
  const res = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/messages`
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch session messages: ${res.status}`);
  }
  const data: SessionMessagesResponse = await res.json();
  return data.messages;
}
