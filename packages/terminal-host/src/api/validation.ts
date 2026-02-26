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

export const OpenGuiSchema = z.object({
  terminal: z.enum(['ghostty', 'iterm2', 'terminal']).optional().default('ghostty'),
});

export const ArrangeWindowSchema = z.object({
  arrangement: z
    .enum([
      'left_half',
      'right_half',
      'fullscreen',
      'top_half',
      'bottom_half',
      'center',
    ])
    .describe('Window arrangement preset'),
});

export type CreateSessionInput = z.infer<typeof CreateSessionSchema>;
export type SessionInputInput = z.infer<typeof SessionInputSchema>;
export type OpenGuiInput = z.infer<typeof OpenGuiSchema>;
export type ArrangeWindowInput = z.infer<typeof ArrangeWindowSchema>;
