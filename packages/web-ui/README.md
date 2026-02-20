# Voice Agent Web Interface

Real-time web dashboard for the Pi voice agent. Displays conversation transcripts, agent state, and CLI session management.

## Quick Start

```bash
cd packages/web-ui

# Install dependencies
bun install

# Run development server
bun run dev

# Build for production
bun run build
```

**Dev server:** http://localhost:5173

## Tech Stack

- **Runtime**: Bun
- **Framework**: React 19 + TypeScript
- **Build**: Vite 7
- **Styling**: Tailwind CSS v4 + CSS-in-JS
- **State**: Zustand

## Project Structure

```
packages/web-ui/
├── src/
│   ├── components/
│   │   ├── EventLog.tsx         # Expandable debug panel (bottom-right)
│   │   ├── SessionSidebar.tsx   # CLI sessions panel (left)
│   │   ├── StatusIndicator.tsx  # Connection/state badges (header)
│   │   ├── TranscriptView.tsx   # Conversation messages
│   │   └── VoiceVisualizer.tsx  # Audio waveform bars
│   │
│   ├── hooks/
│   │   └── useWebSocket.ts      # WebSocket connection to voice-agent
│   │
│   ├── stores/
│   │   ├── agent.ts             # Agent state (messages, status, events)
│   │   └── sessions.ts          # CLI session state
│   │
│   ├── styles/
│   │   └── index.css            # Global styles + Tailwind
│   │
│   ├── types/
│   │   └── index.ts             # TypeScript types
│   │
│   ├── App.tsx                  # Main layout
│   └── main.tsx                 # Entry point
│
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Environment Variables

Create `.env` for production:

```bash
# WebSocket URL to voice-agent (required for live mode)
VITE_WS_URL=ws://marlon.local:3001

# Enable demo mode with mock data (optional)
VITE_DEMO_MODE=true
```

## Demo Mode vs Live Mode

### Demo Mode (default)

When `VITE_WS_URL` is not set, the app runs in demo mode:

- **WebSocket disabled** - No connection attempts to voice-agent
- **Mock conversation loaded** - 8 sample messages in German demonstrating todos, timers, lights, and weather
- **State set to "listening"** - Shows active UI state
- **Profile set to "Jarvis"** - Shows profile badge

**Mocked data** (`stores/agent.ts`):
```typescript
const mockConversation = [
  { role: 'user', content: 'Hey Jarvis, was steht auf meiner Todo-Liste?' },
  { role: 'assistant', content: 'Du hast drei Aufgaben: Den Schnuddelstall aufräumen...' },
  { role: 'user', content: 'Stell einen Timer auf 5 Minuten für den Tee.' },
  { role: 'assistant', content: 'Timer gesetzt auf 5 Minuten...' },
  { role: 'user', content: 'Mach die Stehlampe auf eine gemütliche Farbe.' },
  { role: 'assistant', content: 'Die Stehlampe hat jetzt ein warmes, gemütliches Licht...' },
  { role: 'user', content: 'Was ist das Wetter morgen in Bonn?' },
  { role: 'assistant', content: 'Morgen in Bonn wird es bewölkt mit Temperaturen um 8 Grad...' },
];
```

The mock also includes 12 sample events in the Event Log (tool calls for `view_todos`, `set_timer`, `control_light`, `web_search`).

### Live Mode

To connect to the real voice-agent:

```bash
# Create .env file
echo "VITE_WS_URL=ws://marlon.local:3001" > .env

# Restart dev server
bun run dev
```

Or set the environment variable inline:

```bash
VITE_WS_URL=ws://marlon.local:3001 bun run dev
```

### Disabling Demo Mode

The demo mode logic is in `hooks/useWebSocket.ts`:

```typescript
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true' || !import.meta.env.VITE_WS_URL;
```

To force live mode even without a working WebSocket server (will show "Offline" state):

```bash
VITE_WS_URL=ws://localhost:3001 VITE_DEMO_MODE=false bun run dev
```

To disable mock data loading, comment out in `App.tsx`:

```typescript
// useEffect(() => {
//   loadMockConversation();
// }, [loadMockConversation]);
```

## WebSocket Protocol

The frontend connects to the voice-agent WebSocket server on port 3001.

### Message Types (Server → Client)

| Type | Payload | Description |
|------|---------|-------------|
| `state_change` | `{ state, profile }` | Agent state changed (idle/listening/thinking/speaking) |
| `transcript` | `{ id, text, role, final }` | Conversation message |
| `item_pending` | `{ itemId, role }` | Transcription in progress (show typing indicator) |
| `item_completed` | `{ itemId, text, role }` | Transcription completed |
| `tool_start` | `{ name, args }` | Tool execution started |
| `tool_end` | `{ name, result }` | Tool execution completed |
| `session_started` | `{ profile }` | Voice session started |
| `session_ended` | `{}` | Voice session ended |
| `error` | `{ message }` | Error occurred |

### Agent States

| State | Color | Description |
|-------|-------|-------------|
| `idle` | Gray (#6a6a80) | Waiting for wake word |
| `listening` | Cyan (#4ecdc4) | Capturing user speech |
| `thinking` | Purple (#9b7dea) | Processing/generating response |
| `speaking` | Green (#45b87f) | Playing audio response |

## Components

### TranscriptView

Displays conversation messages in a chat-style layout:
- User messages: Right-aligned, teal background
- Agent messages: Left-aligned, dark card with border
- Typing indicator: Animated dots when waiting for transcription
- Tool indicator: Shows when agent is executing a tool

### VoiceVisualizer

Animated audio waveform with 24 bars. Animation varies by state:
- **Idle**: Slow breathing effect
- **Listening**: Wave pulse from center
- **Thinking**: Rapid alternating heights
- **Speaking**: Dynamic dancing pattern

### SessionSidebar

CLI session management panel:
- Lists active and completed sessions
- Shows session goal, status, and time
- Click to select session (future: view details)

### EventLog

Collapsible debug panel showing raw WebSocket events:
- Click header to expand/collapse
- Color-coded by event type
- Shows timestamp and payload preview

## Styling

Uses CSS custom properties defined in `index.css`:

```css
/* Colors */
--color-bg-primary: #0a0a0f;
--color-bg-secondary: #12121a;
--color-bg-elevated: #1a1a24;
--color-text-primary: #e8e8f0;
--color-text-secondary: #a0a0b8;
--color-accent-cyan: #4ecdc4;
--color-accent-green: #45b87f;
--color-accent-purple: #9b7dea;

/* Typography */
--font-sans: 'Inter', sans-serif;
--font-mono: 'JetBrains Mono', monospace;
```

## State Management

### Agent Store (`stores/agent.ts`)

```typescript
interface AgentStore {
  connected: boolean;
  state: 'idle' | 'listening' | 'thinking' | 'speaking';
  profile: string | null;
  messages: TranscriptMessage[];
  events: RealtimeEvent[];
  currentTool: { name: string; args?: Record<string, unknown> } | null;

  // Actions
  setConnected(connected: boolean): void;
  handleMessage(msg: WSMessage): void;
  loadMockConversation(): void;
  clearMessages(): void;
  reset(): void;
}
```

### Sessions Store (`stores/sessions.ts`)

```typescript
interface SessionsStore {
  sessions: CliSession[];
  selectedSessionId: string | null;
  loading: boolean;

  // Actions
  setSessions(sessions: CliSession[]): void;
  selectSession(id: string): void;
  updateSession(id: string, updates: Partial<CliSession>): void;
}
```

## Backend Integration

### Pi-Agent WebSocket Server

The voice-agent needs to run a WebSocket server on port 3001. See `packages/voice-agent/src/api/websocket.ts`:

```typescript
// Broadcast helpers
wsBroadcast.stateChange(state, profile);
wsBroadcast.transcript(text, role, itemId, final);
wsBroadcast.toolStart(name, args);
wsBroadcast.toolEnd(name, result);
```

### Future: Session API

The sessions sidebar is prepared for integration with the Mac daemon API:

```
GET  /sessions              # List all sessions
GET  /sessions/:id          # Get session details
GET  /sessions/:id/output   # Get session output
POST /sessions/:id/input    # Send input to session
```

## Development

```bash
# Type check
bun run typecheck

# Build
bun run build

# Preview production build
bun run preview
```

## Deployment

Build the static files and serve from any web server:

```bash
bun run build
# Output in dist/
```

Or serve directly from voice-agent by adding static file serving to the webhook server.

## Future Enhancements

- [ ] Session output streaming (tmux integration)
- [ ] Send input to active sessions
- [ ] Pipeline customization (prompts, models)
- [ ] Audio level visualization (real microphone data)
- [ ] Conversation history persistence
- [ ] Mobile responsive layout
