# Codebase Inspection

**Request:** Find the source of duplicate state updates causing UI flicker in ThreadRail. Issues: 1) WebSocket showing 'Reusing existing connection' twice on session click, 2) Voice session in ThreadRail flickering - appearing not at root then reappearing at root. Look for: React StrictMode double-mount issues, duplicate WebSocket connections, session tree state being set multiple times, useUrlSessionSync triggering multiple focusSession calls, and any race conditions in session focusing.

---

This report maps the architecture and data flow related to session focusing and state synchronization to investigate UI flickering and duplicate connection logs in the VΞRTΞX dashboard.

### 1) Architecture Map

*   **Unified State Core**: `useUnifiedSessionsStore` (`web/src/stores/unified-sessions.ts`) serves as the central authority for session trees, focusing logic, and audio/agent states.
*   **Dual-Path Synchronization**: The system maintains state alignment through two concurrent paths: a URL-based router (`web/src/hooks/useRouter.ts`) and a WebSocket event handler (`web/src/stores/message-handler.ts`).
*   **Singleton Resource Management**: Critical resources like WebSockets and Terminal PTYs use module-level singletons with reference counting (`useWebSocket.ts`, `terminal-client.ts`) to mitigate React 19 / StrictMode double-mounting.
*   **Dynamic Stage Orchestration**: `StageOrchestrator.tsx` dynamically switches between `AgentStage` and `TerminalStage` based on the `focusedSessionId` and its corresponding metadata in the sessions Map.
*   **Data Boundaries**: Session hierarchy and real-time events flow via WebSockets, while detailed message history is retrieved on-demand via the REST API (`sessions-api.ts`).

### 2) Existing Flow (Session Navigation)

*   **Trigger**: A user clicks a session in `ThreadRail.tsx` or `BackgroundRail.tsx`, which calls `navigateToSession(id)`.
*   **URL Update**: The `useRouter` module updates `window.location.pathname`, triggering a `popstate` event.
*   **URL Synchronization**: `useUrlSessionSync` (in `App.tsx`) detects the URL change and calls `store.focusSession(id)`.
*   **Store Reconciliation**: `focusSession` updates the `focusedSessionId` and triggers `loadSessionHistory(id)`, which fetches missing messages from the REST API.
*   **WebSocket Interleaving**: Simultaneously, `session_tree_update` events arrive via the WebSocket, causing the store to re-evaluate the tree structure and potentially adjust focus if the current session is missing or finished.
*   **View Transition**: The `StageOrchestrator` detects the updated focus and triggers an `AnimatePresence` transition, which mounts the new Stage component (e.g., `TerminalStage`).

### 3) Relevant Code Locations

**Entrypoints & Integration Singletons**
*   `web/src/hooks/useWebSocket.ts`: Manages the global WebSocket connection; contains ref-counting logic and connection reuse logs.
*   `web/src/lib/terminal-client.ts`: Contains `getTerminalClient` and the "Reusing connection" logs; manages PTY session multiplexing.
*   `web/src/main.tsx`: Wraps the application in `StrictMode`, which is a suspected factor in duplicate initialization.

**Domain Logic (State & Sync)**
*   `web/src/stores/unified-sessions.ts`: Contains the primary `focusSession` action and the `handleSessionTreeUpdate` logic which reconciles incoming trees with local state.
*   `web/src/hooks/useRouter.ts`: Contains `useUrlSessionSync`, which implements the two-way binding between URL and Zustand state.
*   `web/src/stores/message-handler.ts`: Routes `session_tree_update` and `stream_chunk` events into the store.

**UI Components**
*   `web/src/components/rails/ThreadRail.tsx`: Renders the session tree and the specific logic for showing/hiding the "Voice" root card.
*   `web/src/components/layout/StageOrchestrator.tsx`: Orchestrates transitions between stages; contains the `stageKey` logic that drives `AnimatePresence`.
*   `web/src/components/stages/TerminalStage.tsx`: Mounts the terminal; includes `useEffect` hooks that call `getTerminalClient`.
*   `web/src/components/rails/BackgroundRail.tsx`: Contains navigation triggers that initiate the focus flow.

**Backend Emitters**
*   `pi-agent/src/api/websocket.ts`: The source of `session_tree_update` broadcasts.
*   `pi-agent/src/agent/voice-agent.ts`: Manages voice session lifecycle and triggers tree updates in the DB.