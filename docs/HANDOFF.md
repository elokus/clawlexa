# Handoff: Pi ↔ Mac CLI Session Integration

## What Was Implemented (Phase 4+5)

### Pi Agent Side (pi-agent/)

#### New Files Created

1. **`src/tools/mac-client.ts`** - HTTP client for Mac daemon
   - `checkHealth()` - Health check
   - `startCliSession()` - Start new session
   - `sendCliInput()` - Send input to session
   - `readCliOutput()` - Read session output
   - `listCliSessions()` - List sessions
   - `terminateSession()` - Stop session
   - `waitForCompletion()` - Poll for headless completion

2. **`src/tools/cli-agent.ts`** - GPT-5 orchestration agent
   - Knows all project locations on Mac
   - Decides headless vs interactive mode
   - Passes user request to Claude Code (should NOT elaborate)

3. **`src/tools/developer-session.ts`** - Realtime agent tools
   - `developer_session` - Main delegation tool
   - `check_coding_session` - Status check
   - `send_session_feedback` - Send input
   - `stop_coding_session` - Terminate

4. **`src/api/webhooks.ts`** - Webhook receiver
   - Listens on port 3000
   - Endpoint: `POST /webhooks/cli-status`
   - Updates DB and notifies via TTS

#### Modified Files

- `src/tools/index.ts` - Added CLI tool exports
- `src/agent/profiles.ts` - Updated Marvin with CLI tools, fixed wake word to "computer"
- `src/index.ts` - Added webhook server startup
- `src/wakeword/porcupine.ts` - Fixed wake word mappings

### Wake Words

| Wake Word | Profile | Purpose |
|-----------|---------|---------|
| "Jarvis" | Jarvis | General assistant (todos, timers, lights) |
| "Computer" | Marvin | Developer assistant (CLI sessions) |

---

## Known Issue: Repeated MacClient Output Polling

### Symptom

```
[MacClient] Output status: undefined, lines: 0
[MacClient] Output status: undefined, lines: 0
[MacClient] Output status: undefined, lines: 0
... (repeats continuously)
```

### Root Cause

Something is polling `readCliOutput()` in a loop, even when no session is active. The response has `status: undefined` which suggests:
1. The Mac daemon returns malformed response, OR
2. There's a polling loop somewhere that shouldn't be running

### Investigation Steps

1. **Find the polling code** - Search for where `readCliOutput` is called:
   ```bash
   cd pi-agent
   grep -r "readCliOutput" src/
   ```

2. **Check waitForCompletion** - This function polls in a loop:
   - Located in `src/tools/mac-client.ts:150-170`
   - Used by headless sessions to wait for completion

3. **Check if there's a background poller** - Look for setInterval or similar

### Debug Session

To debug, start fresh:

```bash
# Terminal 1: Mac daemon
cd mac-daemon
npm run dev

# Terminal 2: Pi agent
cd pi-agent
npm run dev

# Terminal 3: Test webhook endpoint
curl http://marlon.local:3000/health

# Terminal 4: Test Mac daemon
curl http://MacBook-Pro-von-Lukasz.local:3100/health
curl http://MacBook-Pro-von-Lukasz.local:3100/sessions
```

### Clean Test Sequence

1. Clear old sessions on Mac:
   ```bash
   # List sessions
   curl http://MacBook-Pro-von-Lukasz.local:3100/sessions

   # Kill all tmux sessions
   tmux kill-server
   ```

2. Clear Pi database entries:
   ```bash
   cd pi-agent
   sqlite3 ~/voice-agent.db "DELETE FROM cli_sessions; DELETE FROM cli_events;"
   ```

3. Start fresh and test:
   - Say "Computer"
   - Say "Starte eine Session im WTS Projekt mit einem einfachen Test"
   - Watch logs for the polling issue

---

## Architecture Reminder

```
Pi (Marvin voice)
    │
    ├─► developer_session tool
    │       │
    │       ▼
    │   CLI Agent (GPT-5) - decides headless/interactive
    │       │
    │       ▼
    │   Mac Client (HTTP)
    │       │
    ▼       ▼
Mac Daemon (port 3100)
    │
    ├─► tmux session
    │       │
    │       ▼
    │   claude --dangerously-skip-permissions "prompt"
    │
    └─► Webhook to Pi (port 3000) on status change
```

---

## Files to Check for Polling Issue

1. `src/tools/mac-client.ts` - `waitForCompletion()` function
2. `src/tools/cli-agent.ts` - `startHeadlessSessionTool` uses waitForCompletion
3. Check if there's any setInterval/setTimeout loop not being cleared

## Mac Daemon Webhook Config

The Mac daemon should POST to:
```
http://marlon.local:3000/webhooks/cli-status
```

Payload:
```json
{
  "sessionId": "abc123",
  "status": "finished" | "waiting_for_input" | "error",
  "message": "optional details"
}
```
