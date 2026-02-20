# Terminal Host

CLI execution daemon for the voice agent system. Manages tmux-backed CLI sessions (Claude Code, etc.) and exposes an HTTP API for control.

## Prerequisites

- Node.js 18+
- tmux (`brew install tmux`)

## Installation

```bash
npm install
```

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | HTTP server port |
| `PI_WEBHOOK_URL` | - | Pi webhook URL for status notifications |

## API Endpoints

### Create Session
```bash
POST /sessions
Content-Type: application/json

{
  "sessionId": "abc123",
  "goal": "Fix the login bug",
  "command": "claude"  # optional, defaults to "claude"
}
```

### List Sessions
```bash
GET /sessions
```

### Get Session Details
```bash
GET /sessions/:id
```

### Send Input to Session
```bash
POST /sessions/:id/input
Content-Type: application/json

{
  "input": "y"
}
```

### Read Session Output
```bash
GET /sessions/:id/output
```

### Terminate Session
```bash
DELETE /sessions/:id
```

### Health Check
```bash
GET /health
```

## tmux Integration

Sessions are created as tmux sessions with the naming convention:
```
dev-assistant-{sessionId}
```

You can manually attach to a session:
```bash
tmux attach -t dev-assistant-abc123
```

## Session Status

Sessions have the following statuses:
- `running` - Command is executing
- `waiting_for_input` - Waiting for user input (detected via heuristics)
- `finished` - Process has exited
- `error` - An error occurred

## Webhook Notifications

When `PI_WEBHOOK_URL` is configured, the daemon will POST status changes:

```json
{
  "sessionId": "abc123",
  "status": "waiting_for_input",
  "message": "Session waiting_for_input"
}
```
