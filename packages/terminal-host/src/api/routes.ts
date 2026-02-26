import { Router, Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { SessionManager } from '../sessions/manager.js';
import { terminalOpener } from '../gui/terminal-opener.js';
import {
  CreateSessionSchema,
  SessionInputSchema,
  SessionIdParamSchema,
  OpenGuiSchema,
  ArrangeWindowSchema,
} from './validation.js';

export function createSessionRoutes(sessionManager: SessionManager): Router {
  const router = Router();

  /**
   * POST /sessions - Create a new session
   */
  router.post('/sessions', async (req: Request, res: Response) => {
    try {
      const input = CreateSessionSchema.parse(req.body);

      const session = await sessionManager.createSession({
        sessionId: input.sessionId,
        goal: input.goal,
        command: input.command,
      });

      res.status(201).json({
        success: true,
        data: {
          sessionId: session.sessionId,
          tmuxSession: session.tmuxSession,
          goal: session.goal,
          status: session.status,
          createdAt: session.createdAt,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ success: false, error: message });
    }
  });

  /**
   * GET /sessions - List all sessions
   */
  router.get('/sessions', async (_req: Request, res: Response) => {
    try {
      const sessions = sessionManager.listSessions();
      res.json({
        success: true,
        data: sessions,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ success: false, error: message });
    }
  });

  /**
   * GET /sessions/:id - Get session details
   */
  router.get('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const { id } = SessionIdParamSchema.parse(req.params);

      const session = sessionManager.getSession(id);
      if (!session) {
        res.status(404).json({
          success: false,
          error: `Session ${id} not found`,
        });
        return;
      }

      res.json({
        success: true,
        data: session,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ success: false, error: message });
    }
  });

  /**
   * POST /sessions/:id/input - Send input to a session
   */
  router.post('/sessions/:id/input', async (req: Request, res: Response) => {
    try {
      const { id } = SessionIdParamSchema.parse(req.params);
      const { input } = SessionInputSchema.parse(req.body);

      await sessionManager.sendInput(id, input);

      res.json({
        success: true,
        message: 'Input sent',
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: message });
    }
  });

  /**
   * GET /sessions/:id/output - Read output from a session
   */
  router.get('/sessions/:id/output', async (req: Request, res: Response) => {
    try {
      const { id } = SessionIdParamSchema.parse(req.params);

      const output = await sessionManager.readOutput(id);

      res.json({
        success: true,
        data: output,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: message });
    }
  });

  /**
   * GET /sessions/:id/context - Get terminal context with ANSI colors preserved
   * Used for UI restoration when switching between terminal views.
   */
  router.get('/sessions/:id/context', async (req: Request, res: Response) => {
    try {
      const { id } = SessionIdParamSchema.parse(req.params);
      const lines = parseInt(req.query.lines as string) || 100;

      const context = await sessionManager.readContext(id, lines);

      res.json({
        success: true,
        data: { lines: context },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: message });
    }
  });

  /**
   * POST /sessions/:id/open-gui - Open a GUI terminal window attached to this tmux session
   */
  router.post('/sessions/:id/open-gui', async (req: Request, res: Response) => {
    try {
      const { id } = SessionIdParamSchema.parse(req.params);
      const { terminal } = OpenGuiSchema.parse(req.body ?? {});

      const session = sessionManager.getSession(id);
      if (!session) {
        res.status(404).json({
          success: false,
          error: `Session ${id} not found`,
        });
        return;
      }

      await terminalOpener.openTerminal(session.tmuxSession, terminal);

      res.json({
        success: true,
        message: `Opened ${terminal} window for session ${id}`,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: message });
    }
  });

  /**
   * POST /sessions/:id/close-gui - Close the GUI terminal window for this tmux session
   */
  router.post('/sessions/:id/close-gui', async (req: Request, res: Response) => {
    try {
      const { id } = SessionIdParamSchema.parse(req.params);

      const session = sessionManager.getSession(id);
      if (!session) {
        res.status(404).json({
          success: false,
          error: `Session ${id} not found`,
        });
        return;
      }

      await terminalOpener.closeTerminal(session.tmuxSession);

      res.json({
        success: true,
        message: `Closed GUI window for session ${id}`,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: message });
    }
  });

  /**
   * POST /sessions/:id/arrange - Arrange the GUI terminal window for this session
   */
  router.post('/sessions/:id/arrange', async (req: Request, res: Response) => {
    try {
      const { id } = SessionIdParamSchema.parse(req.params);
      const { arrangement } = ArrangeWindowSchema.parse(req.body);

      const session = sessionManager.getSession(id);
      if (!session) {
        res.status(404).json({
          success: false,
          error: `Session ${id} not found`,
        });
        return;
      }

      await terminalOpener.arrangeWindow(session.tmuxSession, arrangement);

      res.json({
        success: true,
        message: `Arranged session ${id} as ${arrangement}`,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: message });
    }
  });

  /**
   * DELETE /sessions/:id - Terminate a session
   */
  router.delete('/sessions/:id', async (req: Request, res: Response) => {
    try {
      const { id } = SessionIdParamSchema.parse(req.params);

      await sessionManager.terminateSession(id);

      res.json({
        success: true,
        message: `Session ${id} terminated`,
      });
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ success: false, error: message });
    }
  });

  return router;
}
