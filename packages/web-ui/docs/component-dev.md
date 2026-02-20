# Component Development Environment

A dedicated environment for developing and testing UI components in isolation with simulated agent streaming data.

## Quick Start

```bash
# Terminal 1: Backend (with demo routes)
cd pi-agent
npm run dev

# Terminal 2: Frontend
cd web
npm run dev

# Open browser
open http://localhost:5173/dev
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          /dev Page                                       │
├───────────────┬─────────────────────────────────────────────────────────┤
│               │                                                         │
│   Sidebar     │              Component Canvas                           │
│   ─────────   │              ────────────────                           │
│               │                                                         │
│   Subagent    │   ┌──────────────────────────────────────────────┐    │
│   └ Activity  │   │  Stream Controls                              │    │
│     Feed      │   │  [Scenario ▼] [Backend ○] [▶ ⏸ ⏹] [1x ▼]   │    │
│               │   └──────────────────────────────────────────────┘    │
│   Session     │                                                         │
│   └ Terminal  │   ┌────────────────────┐ ┌─────────────────────┐      │
│               │   │                    │ │  Event Stream       │      │
│   Convo       │   │  Component Demo    │ │  ─────────────      │      │
│   └ Stream    │   │  (Isolated)        │ │  subagent_activity  │      │
│               │   │                    │ │  reasoning_start    │      │
│               │   │                    │ │  reasoning_delta... │      │
│               │   │                    │ │  tool_call          │      │
│               │   └────────────────────┘ └─────────────────────┘      │
│               │                                                         │
└───────────────┴─────────────────────────────────────────────────────────┘
```

## File Structure

```
web/src/dev/
├── DevPage.tsx                    # Main page component
├── registry.ts                    # Demo registration system
├── index.ts                       # Public exports
├── components/
│   ├── DevSidebar.tsx            # Category-based component selector
│   ├── DevCanvas.tsx             # Isolated render area + event panel
│   └── StreamControls.tsx        # Playback controls + backend toggle
├── hooks/
│   └── useStreamSimulator.ts     # Stream playback with timing
└── demos/
    ├── index.ts                  # Demo imports (registers all demos)
    └── activity-feed/
        ├── index.ts              # Demo registration
        ├── component.tsx         # Demo wrapper component
        └── scenarios.ts          # Mock stream data

pi-agent/src/demo/
├── index.ts                      # Demo API router
└── streams/
    └── index.ts                  # Pre-recorded demo streams
```

## Adding a New Component Demo

### Step 1: Create Demo Directory

```bash
mkdir -p web/src/dev/demos/my-component
```

### Step 2: Create Demo Files

**`web/src/dev/demos/my-component/scenarios.ts`**
```typescript
import type { StreamScenario } from '../../registry';

export const basicScenario: StreamScenario = {
  id: 'my-component-basic',
  name: 'Basic Usage',
  description: 'Demonstrates basic component behavior',
  events: [
    {
      type: 'subagent_activity',
      payload: {
        agent: 'Marvin',
        type: 'reasoning_start',
        payload: {},
      },
      delay: 200, // ms before this event
    },
    // ... more events
  ],
};
```

**`web/src/dev/demos/my-component/component.tsx`**
```typescript
import { MyComponent } from '../../../components/MyComponent';
import type { DemoProps } from '../../registry';

export function MyComponentDemo({ events, isPlaying, onReset }: DemoProps) {
  // Convert stream events to component props
  const componentProps = useMemo(() => {
    return transformEvents(events);
  }, [events]);

  return <MyComponent {...componentProps} />;
}
```

**`web/src/dev/demos/my-component/index.ts`**
```typescript
import { registerDemo } from '../../registry';
import { MyComponentDemo } from './component';
import { basicScenario, advancedScenario } from './scenarios';

registerDemo({
  id: 'my-component',
  name: 'My Component',
  description: 'Description of what this component does',
  category: 'subagent', // or 'session', 'conversation', 'status'
  component: MyComponentDemo,
  scenarios: [basicScenario, advancedScenario],
  backendRoute: '/demo/streams/my-component', // optional
});
```

### Step 3: Register the Demo

Add to `web/src/dev/demos/index.ts`:

```typescript
import './my-component';
```

## Stream Event Format

Events use the same format as WebSocket messages for consistency:

```typescript
interface StreamEvent {
  type: WSMessageType;     // 'subagent_activity', 'cli_session_created', etc.
  payload: unknown;        // Event-specific data
  delay?: number;          // Milliseconds before emitting (for realistic timing)
}
```

### Subagent Activity Events

```typescript
// Reasoning events
{ type: 'subagent_activity', payload: { agent: 'Marvin', type: 'reasoning_start', payload: {} } }
{ type: 'subagent_activity', payload: { agent: 'Marvin', type: 'reasoning_delta', payload: { delta: 'text...' } } }
{ type: 'subagent_activity', payload: { agent: 'Marvin', type: 'reasoning_end', payload: { durationMs: 2340 } } }

// Tool events
{ type: 'subagent_activity', payload: { agent: 'Marvin', type: 'tool_call', payload: { toolName: 'start_headless_session', toolCallId: 'call_123', args: {...} } } }
{ type: 'subagent_activity', payload: { agent: 'Marvin', type: 'tool_result', payload: { toolCallId: 'call_123', result: '...' } } }

// Response events
{ type: 'subagent_activity', payload: { agent: 'Marvin', type: 'response', payload: { text: 'Final response...' } } }
{ type: 'subagent_activity', payload: { agent: 'Marvin', type: 'complete', payload: { success: true } } }

// Error event
{ type: 'subagent_activity', payload: { agent: 'Marvin', type: 'error', payload: { message: 'Error message' } } }
```

## Adding Backend Demo Streams

For real streaming from backend (useful for testing with production-like data):

**`pi-agent/src/demo/streams/index.ts`**
```typescript
const myStream: DemoStream = {
  id: 'my-stream',
  name: 'My Stream',
  description: 'Description of this stream',
  agent: 'Marvin',
  events: [
    // Same format as frontend scenarios
  ],
};

streams.set(myStream.id, myStream);
```

## Stream Controls

| Control | Description |
|---------|-------------|
| **Scenario Selector** | Choose from available scenarios for the component |
| **Backend Toggle** | Switch between frontend mocks and backend streaming |
| **Play/Pause** | Start or pause stream playback |
| **Step** | Emit single event (for debugging) |
| **Reset** | Clear events and restart |
| **Speed** | Adjust playback speed (0.5x - 10x) |

## Backend API

| Endpoint | Description |
|----------|-------------|
| `HEAD /api/demo/health` | Check backend availability |
| `GET /api/demo/streams` | List available streams |
| `GET /api/demo/streams/:id` | SSE stream of events |

## Categories

| Category | Description |
|----------|-------------|
| `subagent` | Agent activity visualization (ActivityFeed) |
| `session` | CLI session components (TerminalStage) |
| `conversation` | Chat/transcript components |
| `status` | State indicators (VoiceIndicator) |

## Best Practices

1. **Realistic Timing**: Use `delay` values that match real agent behavior
2. **Complete Scenarios**: Include all event types the component handles
3. **Edge Cases**: Add scenarios for errors and unusual states
4. **Isolation**: Demo components should not depend on global stores
5. **Documentation**: Add descriptions to scenarios explaining what they test

## Capturing Real Data

To capture real agent streams for demos:

1. Run the voice agent normally
2. Trigger the interaction you want to capture
3. Copy events from the WebSocket log
4. Format into a StreamScenario

Future: Automated capture via `POST /api/demo/capture/start`.
