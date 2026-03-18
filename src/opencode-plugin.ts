// OpenCode plugin entry point for opencode-mem.
// This module is intended to be used from an OpenCode plugin loader.
// It mirrors the core behavior of claude-mem at a smaller scale:
// - create SQLite-backed sessions per project
// - capture tool executions as observations
// - record basic session lifecycle events

import path from 'path';
import { MemoryStore } from './db';
import { startDashboardServer } from './dashboard';

type AnyEvent = {
  type?: string;
  sessionId?: string | number;
  session?: { id?: string | number };
};

// Minimal view of the OpenCode plugin context based on
// https://dev.to/einarcesar/does-opencode-support-hooks-a-complete-guide-to-extensibility-k3p
// We only rely on fields we actually use.
type PluginContext = {
  project?: { name?: string };
  directory?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client?: any;
  // Bun shell helper in OpenCode plugins
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $?: any;
};

interface SessionMapping {
  dbSessionId: number;
  project: string;
}

export const OpenCodeMemPlugin = async (ctx: PluginContext) => {
  const baseDir = ctx.directory || process.cwd();
  const dbPath = path.join(baseDir, 'memory.sqlite');
  const store = new MemoryStore(dbPath);
  await store.init();

  const sessionById = new Map<string, SessionMapping>();

  let dashboardStarted = false;

  async function ensureDashboardServer(): Promise<void> {
    if (dashboardStarted) return;
    const enabledEnv = process.env.OPENCODE_MEM_DASHBOARD;
    if (enabledEnv && (enabledEnv === '0' || enabledEnv.toLowerCase() === 'false')) {
      return;
    }

    dashboardStarted = true;
    const portEnv = process.env.OPENCODE_MEM_DASHBOARD_PORT;
    const port = portEnv ? parseInt(portEnv, 10) || 48765 : 48765;

    try {
      // Fire and forget; do not block plugin initialization.
      void startDashboardServer({ dbPath, port });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('opencode-mem: failed to start dashboard server', err);
    }
  }

  function getEventSessionKey(event: AnyEvent | undefined): string {
    if (!event) return 'default';
    const raw = event.sessionId ?? event.session?.id;
    if (raw === undefined || raw === null) return 'default';
    return String(raw);
  }

  async function getOrCreateSessionForEvent(event: AnyEvent | undefined): Promise<SessionMapping> {
    const key = getEventSessionKey(event);
    const existing = sessionById.get(key);
    if (existing) return existing;

    await ensureDashboardServer();

    const projectName = ctx.project?.name || path.basename(baseDir);

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

  return {
    // Generic event stream – we listen for session lifecycle events here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: async ({ event }: { event: AnyEvent }) => {
      if (!event || !event.type) return;

      if (event.type === 'session.created') {
        await ensureDashboardServer();
        const key = getEventSessionKey(event);
        const projectName = ctx.project?.name || path.basename(baseDir);
        const dbId = await store.createSession(projectName);
        sessionById.set(key, { dbSessionId: dbId, project: projectName });
        await store.addObservation(dbId, 'system', 'OpenCode session created.', {
          source: 'opencode-plugin',
          eventType: event.type
        });
      } else if (event.type === 'session.deleted') {
        const key = getEventSessionKey(event);
        const mapping = sessionById.get(key);
        if (mapping) {
          await store.endSession(mapping.dbSessionId, 'OpenCode session deleted.');
        }
      } else if (event.type === 'session.compacted' || event.type === 'session.updated') {
        const mapping = await getOrCreateSessionForEvent(event);
        await store.addObservation(mapping.dbSessionId, 'system', 'OpenCode session lifecycle event.', {
          source: 'opencode-plugin',
          eventType: event.type
        });
      }
    },

    tool: {
      execute: {
        // Capture tool executions as observations, following the
        // `tool.execute.after` shape from the OpenCode plugin guide.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        after: async (input: any, output: any) => {
          try {
            const mapping = await getOrCreateSessionForEvent(input as AnyEvent);
            const toolName = String(input.tool || 'unknown');
            const args = input.args ?? {};
            const ok = !output?.error;

            const contentLines: string[] = [];
            contentLines.push(`Tool: ${toolName}`);
            contentLines.push(`Success: ${ok}`);
            contentLines.push('Args: ' + JSON.stringify(args));
            if (output?.result !== undefined) {
              const raw = JSON.stringify(output.result);
              contentLines.push('Result: ' + raw.slice(0, 4000));
            }

            await store.addObservation(mapping.dbSessionId, 'tool', contentLines.join('\n'), {
              tool: toolName,
              ok,
              args,
              // Truncate large results but keep a short snippet in metadata.
              snippet: output?.result ? String(JSON.stringify(output.result)).slice(0, 512) : undefined
            });
          } catch (err) {
            // Best-effort capture; do not let errors break OpenCode.
            // eslint-disable-next-line no-console
            console.error('opencode-mem: error capturing tool execution', err);
          }
        }
      }
    }
  };
};

// Default export for OpenCode's legacy `plugin` array loader,
// which expects the module itself to be a plugin function.
export default OpenCodeMemPlugin;
