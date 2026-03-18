import yargs from 'yargs';
import { MemoryStore } from './db';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import { startDashboardServer } from './dashboard';

const execAsync = promisify(exec);

// Store memory.sqlite in current directory or user home if preferred
const DB_PATH = path.join(process.cwd(), 'memory.sqlite');
const SESSION_FILE = path.join(process.cwd(), '.session');

const store = new MemoryStore(DB_PATH);

async function getActiveSessionId(): Promise<number | null> {
  if (fs.existsSync(SESSION_FILE)) {
    const id = parseInt(fs.readFileSync(SESSION_FILE, 'utf-8').trim(), 10);
    return isNaN(id) ? null : id;
  }
  return null;
}

async function setActiveSessionId(id: number) {
  fs.writeFileSync(SESSION_FILE, id.toString());
}

async function clearActiveSessionId() {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
  }
}

async function isDashboardRunning(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ hostname: 'localhost', port, path: '/api/sessions', timeout: 1000 }, (res) => {
      const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
      res.resume();
      resolve(ok);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

yargs(process.argv.slice(2))
  .command('start-session <project>', 'Start a new memory session', (yargs) => {
    return yargs.positional('project', { describe: 'Project name', type: 'string' });
  }, async (argv) => {
    try {
      await store.init();
      const sessionId = await store.createSession(argv.project as string);
      await setActiveSessionId(sessionId);
      console.log(`Session started for project '${argv.project}' (ID: ${sessionId})`);
    } catch (err) {
      console.error('Error starting session:', err);
    } finally {
      await store.close();
    }
  })
  .command('end-session [summary]', 'End the current memory session', (yargs) => {
    return yargs.positional('summary', { describe: 'Optional summary of the session', type: 'string' });
  }, async (argv) => {
    try {
      const sessionId = await getActiveSessionId();
      if (!sessionId) {
        console.error('No active session found. Start one with `start-session`.');
        return;
      }
      await store.init();
      await store.endSession(sessionId, argv.summary as string);
      await clearActiveSessionId();
      console.log(`Session ${sessionId} ended.`);
    } catch (err) {
      console.error('Error ending session:', err);
    } finally {
      await store.close();
    }
  })
  .command('run <command...>', 'Run a shell command and log it', (yargs) => {
    return yargs.positional('command', { describe: 'Command to run', type: 'string' });
  }, async (argv) => {
    try {
      const sessionId = await getActiveSessionId();
      if (!sessionId) {
        console.warn('Warning: No active session. Command will not be logged to memory.');
      }
      
      const cmd = (argv.command as unknown as string[]).join(' ');
      console.log(`Running: ${cmd}`);

      const startTime = Date.now();
      let output = '';
      let exitCode = 0;

      try {
        const { stdout, stderr } = await execAsync(cmd);
        output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
        console.log(output);
      } catch (e: any) {
        output = e.stdout + (e.stderr ? `\nSTDERR:\n${e.stderr}` : '') + `\nError: ${e.message}`;
        exitCode = e.code || 1;
        console.error(output);
      }

      if (sessionId) {
        await store.init();
        await store.addObservation(sessionId, 'command', output, {
          command: cmd,
          exitCode,
          duration: Date.now() - startTime
        });
        console.log(`[Logged to Session ${sessionId}]`);
      }

    } catch (err) {
      console.error('Error running command:', err);
    } finally {
      await store.close();
    }
  })
  .command('note <content>', 'Log a text note', (yargs) => {
    return yargs.positional('content', { describe: 'Note content', type: 'string' });
  }, async (argv) => {
    try {
      const sessionId = await getActiveSessionId();
      if (!sessionId) {
        console.error('No active session found.');
        return;
      }
      await store.init();
      await store.addObservation(sessionId, 'note', argv.content as string);
      console.log(`Note logged to Session ${sessionId}`);
    } catch (err) {
      console.error('Error logging note:', err);
    } finally {
      await store.close();
    }
  })
  .command('search <query>', 'Search memory', (yargs) => {
    return yargs.positional('query', { describe: 'Search query', type: 'string' });
  }, async (argv) => {
    try {
      await store.init();
      const results = await store.search(argv.query as string);
      if (results.length === 0) {
        console.log('No matches found.');
      } else {
        results.forEach(r => {
          console.log(`[${r.created_at}] [Session ${r.session_id}] [${r.type}] ${r.content.substring(0, 100)}...`);
        });
      }
    } catch (err) {
      console.error('Error searching:', err);
    } finally {
      await store.close();
    }
  })
  .command('sessions [project]', 'List recent memory sessions', (yargs) => {
    return yargs.positional('project', { describe: 'Optional project filter', type: 'string' });
  }, async (argv) => {
    try {
      await store.init();
      const sessions = await store.getRecentSessions(argv.project as string | undefined, 20);
      if (sessions.length === 0) {
        console.log('No sessions found.');
        return;
      }
      sessions.forEach((s: any) => {
        console.log(`ID ${s.id} | project='${s.project}' | started=${s.started_at} | ended=${s.ended_at || 'active'}`);
      });
    } catch (err) {
      console.error('Error listing sessions:', err);
    } finally {
      await store.close();
    }
  })
  .command('switch-session <id>', 'Switch active session by id', (yargs) => {
    return yargs.positional('id', { describe: 'Session id to activate', type: 'number' });
  }, async (argv) => {
    try {
      await store.init();
      const id = argv.id as number;
      const session = await store.getSession(id);
      if (!session) {
        console.error(`Session ${id} not found.`);
        return;
      }
      await setActiveSessionId(id);
      console.log(`Switched active session to ID ${id} (project='${session.project}')`);
    } catch (err) {
      console.error('Error switching session:', err);
    } finally {
      await store.close();
    }
  })
  .command('dashboard [port]', 'Start HTTP dashboard for memory sessions', (yargs) => {
    return yargs.positional('port', { describe: 'Port to listen on', type: 'number', default: 48765 });
  }, async (argv) => {
    const port = (argv.port as number) || 48765;
    try {
      const alreadyRunning = await isDashboardRunning(port);
      if (alreadyRunning) {
        console.log(`Dashboard already running on http://localhost:${port} – reusing existing instance.`);
        return;
      }

      const dashStore = new MemoryStore(DB_PATH);
      await dashStore.init();
      await startDashboardServer({ store: dashStore, port });
      // keep process alive; do not close store here because dashboard has its own connection
    } catch (err) {
      console.error('Error starting dashboard server:', err);
    }
  })
  .command('hook <event>', 'Handle a hook event', (yargs) => {
    return yargs.positional('event', { describe: 'Event name', type: 'string' });
  }, async (argv) => {
    try {
      const event = argv.event as string;
      const sessionId = await getActiveSessionId();
      
      await store.init();

      if (event === 'SessionStart') {
        const projectName = path.basename(process.cwd());
        console.log(`[Hook] SessionStart triggered for project: ${projectName}`);

        // Auto-capture: Create or resume session
        let currentSessionId = sessionId;

        if (!currentSessionId) {
            // Try to find the most recent session for this project
            const recentSessions = await store.getRecentSessions(projectName, 1);
            if (recentSessions.length > 0) {
                // Resume last session
                currentSessionId = recentSessions[0].id;
                console.log(`[Hook] Resuming existing session ID: ${currentSessionId}`);
            } else {
                // Create new session
                currentSessionId = await store.createSession(projectName);
                console.log(`[Hook] Created new auto-captured session ID: ${currentSessionId}`);
            }
            await setActiveSessionId(currentSessionId!);
        } else {
             console.log(`[Hook] Already attached to session ID: ${currentSessionId}`);
        }
        
        await store.addObservation(currentSessionId!, 'system', `Session auto-captured/resumed for project '${projectName}' via hook.`);

      } else if (event === 'UserPromptSubmit') {
         if (sessionId) {
             const promptContent = argv._[1] || 'User submitted a prompt (content not captured)';
             await store.addObservation(sessionId, 'user_prompt', promptContent as string);
             console.log(`[Hook] Captured user prompt for Session ${sessionId}`);
         } else {
             console.warn('[Hook] UserPromptSubmit triggered but no active session found.');
         }
      } else if (event === 'SessionEnd') {
         if (sessionId) {
             await store.endSession(sessionId, 'Session ended via hook.');
             await clearActiveSessionId();
             console.log(`[Hook] Session ${sessionId} ended.`);
         }
      } else {
        console.log(`[Hook] Unhandled event: ${event}`);
      }

    } catch (err) {
      console.error('Error handling hook:', err);
    } finally {
      await store.close();
    }
  })
  .command('status', 'Show current session status', () => {}, async () => {
    const sessionId = await getActiveSessionId();
    if (sessionId) {
      console.log(`Active Session ID: ${sessionId}`);
    } else {
      console.log('No active session.');
    }
  })
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .argv;
