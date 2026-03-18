import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export class MemoryStore {
  private db: Database | null = null;
  private dbPath: string;

  constructor(dbPath: string = './memory.sqlite') {
    this.dbPath = dbPath;
  }

  async init() {
    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    await this.db.exec(`
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
        type TEXT NOT NULL, -- 'command', 'file_read', 'file_write', 'note', 'tool_output'
        content TEXT,
        metadata TEXT, -- JSON string for extra details (e.g. file path, command args)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    `);
  }

  async createSession(project: string): Promise<number> {
    if (!this.db) await this.init();
    const result = await this.db!.run(
      'INSERT INTO sessions (project) VALUES (?)',
      project
    );
    return result.lastID!;
  }

  async endSession(sessionId: number, summary?: string): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.run(
      'UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, summary = ? WHERE id = ?',
      summary || null,
      sessionId
    );
  }

  async addObservation(sessionId: number, type: string, content: string, metadata: object = {}): Promise<void> {
    if (!this.db) await this.init();
    await this.db!.run(
      'INSERT INTO observations (session_id, type, content, metadata) VALUES (?, ?, ?, ?)',
      sessionId,
      type,
      content,
      JSON.stringify(metadata)
    );
  }

  async getSession(sessionId: number): Promise<any> {
    if (!this.db) await this.init();
    return await this.db!.get('SELECT * FROM sessions WHERE id = ?', sessionId);
  }

  async getRecentSessions(project?: string, limit: number = 5): Promise<any[]> {
    if (!this.db) await this.init();
    let query = 'SELECT * FROM sessions';
    const params: any[] = [];
    if (project) {
      query += ' WHERE project = ?';
      params.push(project);
    }
    query += ' ORDER BY started_at DESC LIMIT ?';
    params.push(limit);
    return await this.db!.all(query, ...params);
  }

  async getObservations(sessionId: number): Promise<any[]> {
    if (!this.db) await this.init();
    return await this.db!.all('SELECT * FROM observations WHERE session_id = ? ORDER BY created_at ASC', sessionId);
  }

  async search(query: string): Promise<any[]> {
      if (!this.db) await this.init();
      // Simple LIKE search for now
      const searchPattern = `%${query}%`;
      return await this.db!.all(`
        SELECT o.*, s.project, s.started_at 
        FROM observations o
        JOIN sessions s ON o.session_id = s.id
        WHERE o.content LIKE ? OR o.metadata LIKE ? OR s.project LIKE ?
        ORDER BY o.created_at DESC LIMIT 20
      `, searchPattern, searchPattern, searchPattern);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
