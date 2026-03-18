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
    const searchPattern = `%${query}%`;
    return this.db!.prepare(`
      SELECT o.*, s.project, s.started_at
      FROM observations o
      JOIN sessions s ON o.session_id = s.id
      WHERE o.content LIKE ? OR o.metadata LIKE ? OR s.project LIKE ?
      ORDER BY o.created_at DESC LIMIT 20
    `).all(searchPattern, searchPattern, searchPattern) as any[];
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
