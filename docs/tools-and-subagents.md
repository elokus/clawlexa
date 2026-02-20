# Tools & Subagent Architecture

## Tools

### Jarvis Profile Tools

| Tool | Description |
|------|-------------|
| `add_todo` | Add task with optional due date and assignee |
| `view_todos` | List tasks, optionally filtered by assignee |
| `delete_todo` | Delete a task by ID |
| `set_timer` | Set timer with natural language time ("in 5 minutes") |
| `list_timers` | Show all active timers |
| `cancel_timer` | Cancel a timer by ID |
| `web_search` | Search web via Grok :online (OpenRouter) |
| `control_light` | Control Govee lights (on/off/brightness/color) |

### Marvin Profile Tools (Developer)

| Tool | Description |
|------|-------------|
| `developer_session` | Start/manage coding session on Mac |
| `check_coding_session` | Check session status and output |
| `send_session_feedback` | Send input to running session |
| `stop_coding_session` | Terminate a session |
| `deep_thinking` | Complex analysis with reasoning model |
| `add_todo`, `view_todos`, `delete_todo` | Task management |

### CLI Session Flow

```
User: "Computer, review the code in Kireon Backend"
         │
         ▼
┌─────────────────────────────────────────┐
│  Marvin (Realtime Agent)                │
│  Calls developer_session tool           │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  CLI Orchestration Agent (Grok)         │
│  - Config: subagents/cli/config.json    │
│  - Prompt: subagents/cli/PROMPT.md      │
│  - Decides: headless vs interactive     │
│  - Calls start_headless_session         │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Mac Daemon                             │
│  Runs: cd ~/Code/Work/kireon/           │
│        kireon-backend && claude -p "..."│
└─────────────────────────────────────────┘
```

**Headless mode** (`claude -p "..."`): Quick tasks (reviews, simple fixes)
**Interactive mode** (`claude --dangerously-skip-permissions`): Feature implementation, refactoring

### Adding New Tools

1. Create file in `src/tools/` (e.g., `my-tool.ts`)
2. Use the `tool()` helper from `@openai/agents/realtime`:

```typescript
import { tool } from '@openai/agents/realtime';
import { z } from 'zod';

export const myTool = tool({
  name: 'my_tool',
  description: 'What this tool does',
  parameters: z.object({
    param1: z.string().describe('Parameter description'),
  }),
  async execute({ param1 }) {
    // Tool logic
    return 'Result string (will be spoken)';
  },
});
```

3. Export from `src/tools/index.ts`
4. Add to profile's `tools` array in `src/agent/profiles.ts`

## Subagent Architecture

Subagents live in `src/subagents/<agent>/` with externalized configuration:

```
subagents/
├── loader.ts              # loadAgentConfig(dirPath) utility
├── cli/
│   ├── config.json        # {"name": "Marvin", "model": "x-ai/grok-code-fast-1", "maxSteps": 3}
│   ├── PROMPT.md          # System instructions + project locations
│   ├── tools.ts           # Session management tools
│   └── index.ts           # handleDeveloperRequest(), isMacDaemonAvailable()
└── web-search/
    ├── config.json        # {"name": "Jarvis", "model": "x-ai/grok-4.1-fast:online"}
    ├── PROMPT.md          # German search assistant instructions
    └── index.ts           # webSearchTool export
```

**Adding a new subagent:**
1. Create `src/subagents/<name>/` directory
2. Add `config.json` with `name`, `model`, `maxSteps`
3. Add `PROMPT.md` with system instructions
4. Create `index.ts` using `loadAgentConfig(import.meta.dirname)`
5. Export tool or handler function

## Prompt Management System

Centralized prompt management for all agents with version control and a web-based editor.

### Directory Structure

```
./prompts/
├── jarvis/              # Voice profile
│   ├── config.json      # {"name": "Jarvis", "type": "voice", "activeVersion": "v1"}
│   └── v1.md            # Active prompt version
├── marvin/              # Voice profile
│   ├── config.json
│   └── v1.md
├── cli-orchestrator/    # Subagent
│   ├── config.json
│   └── v1.md
└── web-search/          # Subagent
    ├── config.json
    └── v1.md
```

### REST API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/prompts` | List all prompts |
| GET | `/api/prompts/:id` | Get config + active version content |
| GET | `/api/prompts/:id/versions` | List versions |
| GET | `/api/prompts/:id/versions/:version` | Get specific version |
| POST | `/api/prompts/:id` | Create new version |
| PUT | `/api/prompts/:id/active` | Set active version |

### Variable Interpolation

Prompts support `{{variable}}` syntax for dynamic values:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{agent_name}}` | Profile/config name | "Jarvis" |
| `{{date}}` | Current date (ISO) | "2025-01-15" |
| `{{datetime}}` | Current datetime | "2025-01-15T14:30:00" |
| `{{weekday}}` | Current weekday | "Wednesday" |
| `{{session_id}}` | Current session ID | "sess_abc123" |

### Web UI

Access via the "=" button in the left dock:

- **Sidebar**: Lists prompts grouped by type (Voice / Subagent)
- **Editor**: Version dropdown, Save as New, Set Active buttons
- **Store State**: `activeView`, `selectedPromptId`, `promptContent`, `promptDirty`

### Key Files

| File | Purpose |
|------|---------|
| `prompts/*/config.json` | Prompt metadata + active version |
| `prompts/*/v*.md` | Prompt versions |
| `packages/voice-agent/src/prompts/index.ts` | CRUD service |
| `packages/voice-agent/src/prompts/interpolate.ts` | Variable replacement |
| `packages/voice-agent/src/api/webhooks.ts` | REST endpoints |
| `packages/web-ui/src/lib/prompts-api.ts` | Frontend API client |
| `packages/web-ui/src/components/prompts/` | PromptsView, PromptsSidebar, PromptEditor |
