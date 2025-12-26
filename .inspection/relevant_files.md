# Codebase Inspection

**Request:** Find all relevant files for implementing URL-based session routing in the web frontend. The feature involves: 1) Adding React Router or using existing routing, 2) Creating /session/:sessionId routes, 3) Syncing URL with focusedSessionId state, 4) Loading session history on route mount. Look for: routing configuration, session state management (focusedSessionId), session history loading, and any existing URL handling patterns.

---

The system uses a **Session-Centric Architecture** where the frontend is a React-based Single Page Application (SPA) driven by a unified Zustand state store.

### 1) Architecture Map
*   **Unified State Management:** `useUnifiedSessionsStore` (`web/src/stores/unified-sessions.ts`) acts as the single source of truth, managing session trees, focusing logic, and history reconstruction.
*   **Stage Orchestration:** The UI is organized into "Stages" (`web/src/components/layout/StageOrchestrator.tsx`). The orchestrator determines which component to render based on the session type of the `focusedSessionId`.
*   **Routing Pattern:** Currently utilizes a custom, lightweight hook-based routing system (`web/src/hooks/useRouter.ts`) that performs manual regex matching on `window.location.pathname`.
*   **Data Retrieval:** Session metadata arrives via WebSockets, but conversation history is loaded on-demand via a REST API client (`web/src/lib/sessions-api.ts`).
*   **Sync Logic:** A placeholder hook `useUrlSessionSync` exists in the router module but is not yet fully integrated into the main application lifecycle to bind the store state to the URL.

### 2) Existing Session & Routing Flow
*   **Entry Point:** `web/src/main.tsx` evaluates `window.location.pathname` to decide whether to render the main `App` or the `DevPage`.
*   **Navigation Trigger:** User interaction in navigation rails (e.g., `BackgroundRail.tsx`) calls `focusSession(sessionId)` in the store.
*   **State Update:** `focusSession` updates the `focusedSessionId` and immediately invokes `loadSessionHistory(sessionId)`.
*   **History Loading:** The store checks if messages exist; if not, it calls `fetchSessionMessages` from the REST API and replays the events through the `handleStreamChunk` logic to rebuild the message list.
*   **View Switching:** `StageOrchestrator` detects the change in `focusedSessionId` and triggers an `AnimatePresence` transition to the new session's stage (Terminal or Agent view).
*   **URL/State Disconnect:** Currently, manually entering a session URL does not trigger the store's focusing logic, and clicking a session in the UI does not update the browser's address bar.

### 3) Relevant Code Locations

**Entrypoints**
*   `web/src/main.tsx`: The primary routing junction; currently lacks logic to pass URL parameters into the `App`.
*   `web/index.html`: Base HTML; important if configuring a router that requires `historyApiFallback`.

**Domain & Logic (Routing & State)**
*   `web/src/hooks/useRouter.ts`: Contains `parseRoute`, `useSessionIdFromUrl`, and the unintegrated `useUrlSessionSync` hook intended for store-URL binding.
*   `web/src/stores/unified-sessions.ts`: The central store containing `focusedSessionId`, the `focusSession` action, and the `loadSessionHistory` logic.
*   `web/src/lib/sessions-api.ts`: API client used by the store to fetch historical messages for a session.
*   `web/src/stores/index.ts`: Export hub for session selectors like `useFocusedSession`.

**UI Components**
*   `web/src/App.tsx`: The main layout container where URL synchronization hooks would likely be initialized.
*   `web/src/components/layout/StageOrchestrator.tsx`: The component that reacts to the "focused" state to render the appropriate session view.
*   `web/src/components/rails/BackgroundRail.tsx`: A navigation component that currently triggers session focusing via click events.
*   `web/src/components/rails/ThreadRail.tsx`: Hierarchical navigation that also manages session focus triggers.

**Configuration**
*   `web/vite.config.ts`: Proxy and SPA routing configuration (relevant for `appType: 'spa'` and development server behavior).