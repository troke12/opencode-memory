// OpenCode plugin entry point for opencode-mem.
// This module is intended to be used from an OpenCode plugin loader.
// It mirrors the core behavior of claude-mem at a smaller scale:
// - create SQLite-backed sessions per project
// - capture tool executions as observations
// - record basic session lifecycle events

import path from 'path';
import os from 'os';
import fs from 'fs';
import { MemoryStore } from './db';
import { startDashboardServer } from './dashboard';

// zod is provided by OpenCode's runtime node_modules.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const z = require('zod') as typeof import('zod');

// Mirrors the SDK Event union — only the fields we actually need.
// SDK events carry data in `properties`, not directly on the event.
// e.g. session.created  → properties.info.id
//      session.compacted → properties.sessionID
type AnyEvent = {
  type?: string;
  // Legacy / synthetic events (e.g. created from tool input)
  sessionId?: string | number;
  properties?: {
    info?: { id?: string | number };
    sessionID?: string;
  };
};

// Matches @opencode-ai/plugin PluginInput. project.worktree is the project
// root path; there is no "name" field.
type PluginContext = {
  project?: { id?: string; worktree?: string };
  directory?: string;
  worktree?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $?: any;
};

interface SessionMapping {
  dbSessionId: number;
  project: string;
}

export const OpenCodeMemPlugin = async (ctx: PluginContext) => {
  // Store globally so all projects share one memory database.
  // Override with OPENCODE_MEM_DB env var if needed.
  const globalDir = process.env.OPENCODE_MEM_DB
    ? path.dirname(process.env.OPENCODE_MEM_DB)
    : path.join(os.homedir(), '.local', 'share', 'opencode-memory');
  fs.mkdirSync(globalDir, { recursive: true });
  const dbPath = process.env.OPENCODE_MEM_DB
    ? process.env.OPENCODE_MEM_DB
    : path.join(globalDir, 'memory.sqlite');
  const baseDir = ctx.directory || process.cwd();
  const store = new MemoryStore(dbPath);
  await store.init();

  const debugEnv = process.env.OPENCODE_MEM_DEBUG;
  const debugEnabled = !!debugEnv && debugEnv !== '0' && debugEnv.toLowerCase() !== 'false';

  function debug(...args: unknown[]): void {
    if (!debugEnabled) return;
    // eslint-disable-next-line no-console
    console.log('[opencode-mem]', ...args);
  }

  debug('plugin initialized', { dbPath, baseDir, project: ctx.project?.worktree });

  const sessionById = new Map<string, SessionMapping>();
  let activeSessionCount = 0;
  let shutdownDashboard: (() => void) | null = null;
  let dashboardStarted = false;

  // Track sessions that have already had context injected to avoid repeats.
  const contextInjectedSessions = new Set<string>();

  async function ensureDashboardServer(): Promise<void> {
    if (dashboardStarted) return;
    const enabledEnv = process.env.OPENCODE_MEM_DASHBOARD;
    if (enabledEnv && (enabledEnv === '0' || enabledEnv.toLowerCase() === 'false')) {
      return;
    }

    dashboardStarted = true;
    const portEnv = process.env.OPENCODE_MEM_DASHBOARD_PORT;
    const port = portEnv ? parseInt(portEnv, 10) || 48765 : 48765;

    debug('starting dashboard server', { dbPath, port });
    startDashboardServer({ store, port }).then((shutdown) => {
      shutdownDashboard = shutdown;
    }).catch((err) => {
      dashboardStarted = false;
      // eslint-disable-next-line no-console
      console.error('opencode-mem: dashboard server error', err);
    });
  }

  function tryShutdownDashboard(): void {
    if (activeSessionCount > 0 || !shutdownDashboard) return;
    debug('all sessions closed, shutting down dashboard');
    shutdownDashboard();
    shutdownDashboard = null;
    dashboardStarted = false;
  }

  function getEventSessionKey(event: AnyEvent | undefined): string {
    if (!event) return 'default';
    // Synthetic events (built from tool input) use sessionId directly.
    // Real SDK events carry the ID inside properties.
    const raw = event.sessionId
      ?? event.properties?.info?.id
      ?? event.properties?.sessionID;
    if (raw === undefined || raw === null) return 'default';
    return String(raw);
  }

  async function getOrCreateSessionForEvent(event: AnyEvent | undefined): Promise<SessionMapping> {
    const key = getEventSessionKey(event);
    const existing = sessionById.get(key);
    if (existing) return existing;

    await ensureDashboardServer();

    const projectName = path.basename(ctx.project?.worktree || ctx.worktree || baseDir);

    const recent = await store.getRecentSessions(projectName, 1);
    let dbId: number;
    if (recent.length > 0 && !recent[0].ended_at) {
      dbId = recent[0].id;
    } else {
      dbId = await store.createSession(projectName);
    }

    const mapping: SessionMapping = { dbSessionId: dbId, project: projectName };
    sessionById.set(key, mapping);
    return mapping;
  }

  async function summarizeSession(mapping: SessionMapping): Promise<void> {
    try {
      const observations = await store.getObservations(mapping.dbSessionId);
      const filesRead = new Set<string>();
      const filesEdited = new Set<string>();
      const toolCounts: Record<string, number> = {};

      for (const obs of observations) {
        let meta: Record<string, any> = {};
        try {
          if (obs.metadata) meta = JSON.parse(obs.metadata);
        } catch {
          // ignore malformed metadata
        }
        const tool: string = meta.tool || '';
        if (!tool) continue;

        toolCounts[tool] = (toolCounts[tool] || 0) + 1;

        const filePath: string = meta.args?.file_path || '';
        if (tool === 'read' && filePath) {
          filesRead.add(filePath);
        } else if ((tool === 'write' || tool === 'edit') && filePath) {
          filesEdited.add(filePath);
        }
      }

      const filesReadArr = Array.from(filesRead);
      const filesEditedArr = Array.from(filesEdited);
      const bashCount = toolCounts['bash'] || toolCounts['Bash'] || 0;

      const parts: string[] = [];
      if (filesReadArr.length) parts.push(`Read ${filesReadArr.length} file${filesReadArr.length !== 1 ? 's' : ''}`);
      if (filesEditedArr.length) {
        const names = filesEditedArr.slice(0, 3).map(f => path.basename(f)).join(', ');
        parts.push(`edited ${filesEditedArr.length} file${filesEditedArr.length !== 1 ? 's' : ''} (${names})`);
      }
      if (bashCount) parts.push(`ran ${bashCount} bash command${bashCount !== 1 ? 's' : ''}`);

      const key_actions = parts.length ? parts.join(', ') : 'No significant actions recorded';

      await store.createSummary(mapping.dbSessionId, mapping.project, {
        files_read: filesReadArr,
        files_edited: filesEditedArr,
        tools_used: toolCounts,
        key_actions,
      });
    } catch {
      // silent — do not break OpenCode
    }
  }

  return {
    // Generic event stream – we listen for session lifecycle events here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: async ({ event }: { event: AnyEvent }) => {
      if (!event || !event.type) return;

      debug('event', event.type, { sessionId: getEventSessionKey(event) });

      if (event.type === 'session.created') {
        activeSessionCount++;
        await ensureDashboardServer();
        const key = getEventSessionKey(event);
        const projectName = path.basename(ctx.project?.worktree || ctx.worktree || baseDir);
        const dbId = await store.createSession(projectName);
        sessionById.set(key, { dbSessionId: dbId, project: projectName });
        await store.addObservation(dbId, 'system', 'OpenCode session created.', {
          source: 'opencode-plugin',
          eventType: event.type
        });
      } else if (event.type === 'session.deleted') {
        activeSessionCount = Math.max(0, activeSessionCount - 1);
        const key = getEventSessionKey(event);
        const mapping = sessionById.get(key);
        if (mapping) {
          await store.endSession(mapping.dbSessionId, 'OpenCode session deleted.');
          // Summarize the session before removing from map
          await summarizeSession(mapping);
          sessionById.delete(key);
        }
        tryShutdownDashboard();
      } else if (event.type === 'session.compacted' || event.type === 'session.updated') {
        const mapping = await getOrCreateSessionForEvent(event);
        await store.addObservation(mapping.dbSessionId, 'system', 'OpenCode session lifecycle event.', {
          source: 'opencode-plugin',
          eventType: event.type
        });
      }
    },

    // Flat key as required by @opencode-ai/plugin Hooks interface.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    'tool.execute.after': async (input: { tool: string; sessionID: string; callID: string; args: any }, output: { title: string; output: string; metadata: any }) => {
      try {
        const mapping = await getOrCreateSessionForEvent({ sessionId: input.sessionID } as AnyEvent);
        const toolName = String(input.tool || 'unknown');
        debug('tool.execute.after', { tool: toolName, sessionID: input.sessionID });
        const args = input.args ?? {};

        const contentLines: string[] = [];
        contentLines.push(`Tool: ${toolName}`);
        contentLines.push('Args: ' + JSON.stringify(args));
        if (output?.output !== undefined) {
          contentLines.push('Result: ' + String(output.output).slice(0, 4000));
        }

        await store.addObservation(mapping.dbSessionId, 'tool', contentLines.join('\n'), {
          tool: toolName,
          args,
          snippet: output?.output ? String(output.output).slice(0, 512) : undefined
        });
      } catch (err) {
        // Best-effort capture; do not let errors break OpenCode.
        // eslint-disable-next-line no-console
        console.error('opencode-mem: error capturing tool execution', err);
      }
    },

    // Inject recent session memory into the system prompt, once per session.
    'experimental.chat.system.transform': async (input: { sessionID?: string; model: any }, output: { system: string[] }) => {
      const sid = input.sessionID;
      if (!sid || contextInjectedSessions.has(sid)) return;
      contextInjectedSessions.add(sid);

      try {
        const sessions = await store.getRecentSessionsWithSummaries(5);
        if (!sessions.length) return;

        // Format concise memory block, keep under ~400 tokens
        const lines: string[] = ['<opencode-memory>', 'Recent session context:'];
        for (const { session, summary } of sessions) {
          lines.push(`\n[${session.project} | ${session.started_at.slice(0, 10)}]`);
          if (summary) {
            if (summary.key_actions) lines.push(`  Summary: ${summary.key_actions}`);
            const edited = JSON.parse(summary.files_edited || '[]') as string[];
            if (edited.length) lines.push(`  Files edited: ${edited.slice(0, 5).map((f: string) => f.split('/').pop()).join(', ')}`);
          }
        }
        lines.push('</opencode-memory>');
        output.system.push(lines.join('\n'));
      } catch {
        // silent
      }
    },

    // Register custom mem_search tool so OpenCode can search past session memory.
    tool: {
      mem_search: {
        description: 'Search past OpenCode session memory for relevant context, code patterns, file history, and past decisions. Use this when you need to recall what was done in previous sessions.',
        args: {
          query: z.string().describe('Search query — use keywords related to what you want to recall')
        },
        execute: async ({ query }: { query: string }) => {
          try {
            const results = await store.searchFTS(query, 8);
            if (!results.length) return `No memory found for: "${query}"`;
            const lines = [`Memory search results for "${query}":\n`];
            for (const r of results) {
              lines.push(`[${r.project} | ${r.started_at?.slice(0, 10) || ''}]`);
              lines.push(String(r.content || '').slice(0, 300));
              lines.push('---');
            }
            return lines.join('\n');
          } catch (e) {
            return `Search error: ${String(e)}`;
          }
        }
      }
    }
  };
};

// Default export for OpenCode's legacy `plugin` array loader,
// which expects the module itself to be a plugin function.
export default OpenCodeMemPlugin;
