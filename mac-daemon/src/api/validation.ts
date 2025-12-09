import { z } from 'zod';

export const CreateSessionSchema = z.object({
  sessionId: z.string().min(1).max(100),
  goal: z.string().min(1).max(1000),
  command: z.string().optional().default('claude'),
});

export const SessionInputSchema = z.object({
  input: z.string().min(1).max(10000),
});

export const SessionIdParamSchema = z.object({
  id: z.string().min(1).max(100),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type SessionInputInput = z.infer<typeof SessionInputSchema>;
