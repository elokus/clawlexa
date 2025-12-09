export type SessionStatus =
  | 'running'
  | 'waiting_for_input'
  | 'finished'
  | 'error';

export interface DaemonSession {
  sessionId: string;
  tmuxSession: string;
  goal: string;
  status: SessionStatus;
  outputBuffer: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSessionRequest {
  sessionId: string;
  goal: string;
  command?: string; // defaults to 'claude'
}

export interface SessionInput {
  input: string;
}

export interface SessionOutput {
  sessionId: string;
  output: string[];
  status: SessionStatus;
}

export interface SessionSummary {
  sessionId: string;
  goal: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookPayload {
  sessionId: string;
  status: SessionStatus;
  message?: string;
}
