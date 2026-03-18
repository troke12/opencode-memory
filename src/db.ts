import { Database } from 'bun:sqlite';

export class MemoryStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './memory.sqlite') {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    this.db = new Database(this.dbPath, { create: true });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        summary TEXT
      );

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER,
        type TEXT NOT NULL,
        content TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER UNIQUE,
        project TEXT,
        files_read TEXT DEFAULT '[]',
        files_edited TEXT DEFAULT '[]',
        tools_used TEXT DEFAULT '{}',
        key_actions TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        content, metadata, content=observations, content_rowid=id
      );

      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, content, metadata)
        VALUES (new.id, new.content, COALESCE(new.metadata, ''));
      END;
    `);
  }

  async createSession(project: string): Promise<number> {
    if (!this.db) await this.init();
    const result = this.db!.prepare('INSERT INTO sessions (project) VALUES (?)').run(project);
    return result.lastInsertRowid as number;
  }

  async endSession(sessionId: number, summary?: string): Promise<void> {
    if (!this.db) await this.init();
    this.db!.prepare('UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, summary = ? WHERE id = ?').run(summary ?? null, sessionId);
  }

  async addObservation(sessionId: number, type: string, content: string, metadata: object = {}): Promise<void> {
    if (!this.db) await this.init();
    this.db!.prepare('INSERT INTO observations (session_id, type, content, metadata) VALUES (?, ?, ?, ?)').run(
      sessionId, type, content, JSON.stringify(metadata)
    );
  }

  async getSession(sessionId: number): Promise<any> {
    if (!this.db) await this.init();
    return this.db!.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  }

  async getRecentSessions(project?: string, limit: number = 5): Promise<any[]> {
    if (!this.db) await this.init();
    if (project) {
      return this.db!.prepare('SELECT * FROM sessions WHERE project = ? ORDER BY started_at DESC LIMIT ?').all(project, limit) as any[];
    }
    return this.db!.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit) as any[];
  }

  async getObservations(sessionId: number): Promise<any[]> {
    if (!this.db) await this.init();
    return this.db!.prepare('SELECT * FROM observations WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as any[];
  }

  async search(query: string): Promise<any[]> {
    if (!this.db) await this.init();
    // Try FTS first, fallback to LIKE
    try {
      const ftsResults = await this.searchFTS(query, 20);
      if (ftsResults.length > 0) return ftsResults;
    } catch {
      // fall through to LIKE
    }
    const searchPattern = `%${query}%`;
    return this.db!.prepare(`
      SELECT o.*, s.project, s.started_at
      FROM observations o
      JOIN sessions s ON o.session_id = s.id
      WHERE o.content LIKE ? OR o.metadata LIKE ? OR s.project LIKE ?
      ORDER BY o.created_at DESC LIMIT 20
    `).all(searchPattern, searchPattern, searchPattern) as any[];
  }

  async createSummary(sessionId: number, project: string, data: {
    files_read: string[];
    files_edited: string[];
    tools_used: Record<string, number>;
    key_actions: string;
  }): Promise<void> {
    if (!this.db) await this.init();
    this.db!.prepare(`
      INSERT INTO session_summaries (session_id, project, files_read, files_edited, tools_used, key_actions)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        project = excluded.project,
        files_read = excluded.files_read,
        files_edited = excluded.files_edited,
        tools_used = excluded.tools_used,
        key_actions = excluded.key_actions
    `).run(
      sessionId,
      project,
      JSON.stringify(data.files_read),
      JSON.stringify(data.files_edited),
      JSON.stringify(data.tools_used),
      data.key_actions
    );
  }

  async getSummary(sessionId: number): Promise<any | null> {
    if (!this.db) await this.init();
    return this.db!.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get(sessionId) ?? null;
  }

  async getRecentSessionsWithSummaries(limit: number): Promise<Array<{session: any; summary: any | null}>> {
    if (!this.db) await this.init();
    const sessions = this.db!.prepare('SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?').all(limit) as any[];
    const results: Array<{session: any; summary: any | null}> = [];
    for (const session of sessions) {
      const summary = await this.getSummary(session.id);
      results.push({ session, summary });
    }
    return results;
  }

  async getObservationCount(): Promise<number> {
    if (!this.db) await this.init();
    const row = this.db!.prepare('SELECT COUNT(*) as n FROM observations').get() as { n: number };
    return row.n;
  }

  async searchFTS(query: string, limit: number = 20): Promise<any[]> {
    if (!this.db) await this.init();
    // Build FTS5 OR query: each word becomes an independent term joined with OR
    // so multi-word natural language queries match any containing word.
    const ftsQuery = query
      .split(/\s+/)
      .filter(Boolean)
      .map(w => w.replace(/["*]/g, '')) // strip FTS5 special chars
      .filter(Boolean)
      .join(' OR ');
    return this.db!.prepare(`
      SELECT o.*, s.project, s.started_at
      FROM observations o
      JOIN sessions s ON o.session_id = s.id
      WHERE o.id IN (SELECT rowid FROM observations_fts WHERE observations_fts MATCH ?)
      ORDER BY o.created_at DESC LIMIT ?
    `).all(ftsQuery, limit) as any[];
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
