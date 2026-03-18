import http from 'http';
import { URL } from 'url';
import path from 'path';
import { MemoryStore } from './db';

export interface DashboardOptions {
  store: MemoryStore;
  port?: number;
}

export async function startDashboardServer(options: DashboardOptions): Promise<void> {
  const port = options.port ?? 37777;
  const store = options.store;

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = req.url || '/';
      const url = new URL(reqUrl, `http://localhost:${port}`);

      if (url.pathname === '/api/sessions') {
        const limitParam = url.searchParams.get('limit');
        const limit = limitParam ? parseInt(limitParam, 10) || 20 : 20;
        const project = url.searchParams.get('project') || undefined;
        const sessions = await store.getRecentSessions(project, limit);

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(sessions));
        return;
      }

      if (url.pathname === '/api/search') {
        const query = url.searchParams.get('q') || '';
        const results = query ? await store.search(query) : [];
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(results));
        return;
      }

      if (url.pathname.startsWith('/api/sessions/') && url.pathname.endsWith('/observations')) {
        const parts = url.pathname.split('/').filter(Boolean);
        const idStr = parts[1];
        const sessionId = parseInt(idStr, 10);
        if (!sessionId) {
          res.statusCode = 400;
          res.end('Invalid session id');
          return;
        }

        const observations = await store.getObservations(sessionId);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(observations));
        return;
      }

      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(buildHtml(port));
        return;
      }

      res.statusCode = 404;
      res.end('Not found');
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end('Dashboard error');
      console.error('Dashboard request error:', err);
    }
  });

  server.listen(port, () => {
    console.log(`Memory dashboard listening on http://localhost:${port}`);
  });
}

function buildHtml(port: number): string {
  const apiBase = `http://localhost:${port}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Opencode Memory Dashboard</title>
<style>
body { font-family: system-ui, sans-serif; margin: 0; display: flex; height: 100vh; color: #111; }
.sidebar { width: 320px; border-right: 1px solid #ddd; padding: 16px; box-sizing: border-box; overflow-y: auto; }
.main { flex: 1; padding: 16px; box-sizing: border-box; overflow-y: auto; }
h1 { font-size: 18px; margin: 0 0 12px; }
h2 { font-size: 14px; margin: 0 0 8px; }
.session { padding: 8px; border-radius: 4px; margin-bottom: 6px; cursor: pointer; border: 1px solid transparent; }
.session:hover { background: #f5f5f5; }
.session.active { border-color: #2563eb; background: #eff6ff; }
.session-project { font-weight: 600; }
.session-meta { font-size: 11px; color: #555; }
.obs { padding: 8px 10px; border-radius: 4px; border: 1px solid #e5e7eb; margin-bottom: 8px; background: #fff; }
.obs-header { font-size: 11px; color: #555; margin-bottom: 4px; display: flex; justify-content: space-between; gap: 8px; }
.obs-type { text-transform: uppercase; font-weight: 600; letter-spacing: .04em; }
.obs-content { white-space: pre-wrap; font-family: monospace; font-size: 12px; }
.toolbar { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
input[type="text"] { padding: 4px 6px; font-size: 12px; border-radius: 4px; border: 1px solid #d1d5db; flex: 1; }
.muted { color: #6b7280; font-size: 12px; }
.error { color: #dc2626; font-size: 12px; }
</style>
</head>
<body>
<div class="sidebar">
  <h1>Memory Sessions</h1>
  <div class="toolbar">
    <input id="projectFilter" type="text" placeholder="Filter by project" />
  </div>
  <div id="sessions"><p class="muted">Loading...</p></div>
</div>
<div class="main">
  <h2 id="sessionTitle">Select a session</h2>
  <p class="muted" id="sessionMeta"></p>
  <div id="observations"></div>
</div>
<script>
var API = ${JSON.stringify(apiBase)};
var activeSessionId = null;

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadSessions(project) {
  var url = API + '/api/sessions?limit=50';
  if (project) url += '&project=' + encodeURIComponent(project);
  try {
    var res = await fetch(url);
    var data = await res.json();
    renderSessions(data);
  } catch (e) {
    document.getElementById('sessions').innerHTML = '<p class="error">Error: ' + esc(e.message) + '</p>';
  }
}

async function loadObservations(sessionId) {
  try {
    var res = await fetch(API + '/api/sessions/' + sessionId + '/observations');
    var data = await res.json();
    renderObservations(sessionId, data);
  } catch (e) {
    document.getElementById('observations').innerHTML = '<p class="error">Error: ' + esc(e.message) + '</p>';
  }
}

function renderSessions(sessions) {
  var container = document.getElementById('sessions');
  if (!sessions || !sessions.length) {
    container.innerHTML = '<p class="muted">No sessions yet.</p>';
    return;
  }
  container.innerHTML = '';
  sessions.forEach(function(s) {
    var div = document.createElement('div');
    div.className = 'session' + (s.id === activeSessionId ? ' active' : '');
    div.innerHTML =
      '<div class="session-project">' + esc(s.project) + '</div>' +
      '<div class="session-meta">ID ' + s.id + ' | ' + esc(s.started_at) + '</div>';
    div.onclick = function() {
      activeSessionId = s.id;
      document.querySelectorAll('.session').forEach(function(el) { el.classList.remove('active'); });
      div.classList.add('active');
      loadObservations(s.id);
    };
    container.appendChild(div);
  });
}

function renderObservations(sessionId, observations) {
  document.getElementById('sessionTitle').textContent = 'Session ' + sessionId;
  document.getElementById('sessionMeta').textContent = observations.length + ' observations';
  var container = document.getElementById('observations');
  if (!observations || !observations.length) {
    container.innerHTML = '<p class="muted">No observations yet.</p>';
    return;
  }
  container.innerHTML = '';
  observations.forEach(function(o) {
    var div = document.createElement('div');
    div.className = 'obs';
    div.innerHTML =
      '<div class="obs-header"><span class="obs-type">' + esc(o.type) + '</span><span>' + esc(o.created_at) + '</span></div>' +
      '<div class="obs-content">' + esc(o.content) + '</div>';
    container.appendChild(div);
  });
}

document.getElementById('projectFilter').oninput = function(e) {
  loadSessions(e.target.value.trim() || undefined);
};

// Initial load + auto-refresh every 10s
loadSessions();
setInterval(function() {
  loadSessions(document.getElementById('projectFilter').value.trim() || undefined);
  if (activeSessionId) loadObservations(activeSessionId);
}, 10000);
</script>
</body>
</html>`;
}
