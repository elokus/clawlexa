/**
 * Handoffs Repository
 *
 * Persists HandoffPackets for debugging and replay.
 * Each packet captures the full context transferred from voice to a subagent.
 */

import type { Database } from 'bun:sqlite';
import { getDatabase } from '../database.js';
import type { HandoffPacket } from '../../context/handoff.js';

export interface HandoffRow {
  id: string;
  source_session_id: string;
  target_session_id: string | null;
  request: string;
  voice_context: string;
  active_processes: string | null;
  created_at: string;
}

export class HandoffsRepository {
  private db: Database;

  constructor(db?: Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Save a handoff packet to the database.
   */
  save(packet: HandoffPacket, targetSessionId?: string): void {
    this.db.query(
      `INSERT INTO handoff_packets (id, source_session_id, target_session_id, request, voice_context, active_processes)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      packet.id,
      packet.source.sessionId,
      targetSessionId ?? null,
      packet.request,
      JSON.stringify(packet.voiceContext),
      JSON.stringify(packet.activeProcesses),
    );
  }

  /**
   * Update the target session ID after the subagent session is created.
   */
  setTargetSession(handoffId: string, targetSessionId: string): void {
    this.db.query(
      `UPDATE handoff_packets SET target_session_id = ? WHERE id = ?`
    ).run(targetSessionId, handoffId);
  }

  /**
   * Get a handoff packet by ID.
   */
  findById(id: string): HandoffRow | null {
    return this.db.query(
      `SELECT * FROM handoff_packets WHERE id = ?`
    ).get(id) as HandoffRow | null;
  }

  /**
   * Get all handoffs for a source session (voice session).
   */
  findBySourceSession(sourceSessionId: string): HandoffRow[] {
    return this.db.query(
      `SELECT * FROM handoff_packets WHERE source_session_id = ? ORDER BY created_at DESC`
    ).all(sourceSessionId) as HandoffRow[];
  }
}
