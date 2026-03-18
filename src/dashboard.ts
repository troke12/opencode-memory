import http from 'http';
import { URL } from 'url';
import path from 'path';
import { MemoryStore } from './db';

export interface DashboardOptions {
  dbPath: string;
  port?: number;
}

export async function startDashboardServer(options: DashboardOptions): Promise<void> {
  const port = options.port ?? 37777;
  const store = new MemoryStore(options.dbPath);
  await store.init();

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
    const dbName = path.basename(options.dbPath);
    console.log(`Memory dashboard listening on http://localhost:${port} (DB: ${dbName})`);
  });

  server.on('close', async () => {
    await store.close();
  });
}

function buildHtml(port: number): string {
  const apiBase = `http://localhost:${port}`;
  const htmlParts: string[] = [];
  htmlParts.push('<!DOCTYPE html>');
  htmlParts.push('<html lang="en">');
  htmlParts.push('<head>');
  htmlParts.push('<meta charset="UTF-8" />');
  htmlParts.push('<title>Opencode Memory Dashboard</title>');
  htmlParts.push('<style>');
  htmlParts.push('body { font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; display: flex; height: 100vh; color: #111; }');
  htmlParts.push('.sidebar { width: 320px; border-right: 1px solid #ddd; padding: 16px; box-sizing: border-box; overflow-y: auto; }');
  htmlParts.push('.main { flex: 1; padding: 16px; box-sizing: border-box; overflow-y: auto; }');
  htmlParts.push('h1 { font-size: 18px; margin: 0 0 12px; }');
  htmlParts.push('h2 { font-size: 14px; margin: 0 0 8px; }');
  htmlParts.push('.session { padding: 8px; border-radius: 4px; margin-bottom: 6px; cursor: pointer; border: 1px solid transparent; }');
  htmlParts.push('.session:hover { background: #f5f5f5; }');
  htmlParts.push('.session.active { border-color: #2563eb; background: #eff6ff; }');
  htmlParts.push('.session-project { font-weight: 600; }');
  htmlParts.push('.session-meta { font-size: 11px; color: #555; }');
  htmlParts.push('.obs { padding: 8px 10px; border-radius: 4px; border: 1px solid #e5e7eb; margin-bottom: 8px; background: #fff; }');
  htmlParts.push('.obs-header { font-size: 11px; color: #555; margin-bottom: 4px; display: flex; justify-content: space-between; gap: 8px; }');
  htmlParts.push('.obs-type { text-transform: uppercase; font-weight: 600; letter-spacing: .04em; }');
  htmlParts.push('.obs-content { white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; }');
  htmlParts.push('.toolbar { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }');
  htmlParts.push('input[type="text"] { padding: 4px 6px; font-size: 12px; border-radius: 4px; border: 1px solid #d1d5db; }');
  htmlParts.push('select { padding: 4px 6px; font-size: 12px; border-radius: 4px; border: 1px solid #d1d5db; }');
  htmlParts.push('.muted { color: #6b7280; font-size: 12px; }');
  htmlParts.push('</style>');
  htmlParts.push('</head>');
  htmlParts.push('<body>');
  htmlParts.push('<div class="sidebar">');
  htmlParts.push('<h1>Memory Sessions</h1>');
  htmlParts.push('<div class="toolbar">');
  htmlParts.push('<input id="projectFilter" type="text" placeholder="Filter by project" />');
  htmlParts.push('</div>');
  htmlParts.push('<div id="sessions"></div>');
  htmlParts.push('</div>');
  htmlParts.push('<div class="main">');
  htmlParts.push('<h2 id="sessionTitle">Select a session</h2>');
  htmlParts.push('<p class="muted" id="sessionMeta"></p>');
  htmlParts.push('<div id="observations"></div>');
  htmlParts.push('</div>');
  htmlParts.push('<script>');
  htmlParts.push('const apiBase = ' + JSON.stringify(apiBase) + ';');
  htmlParts.push('async function loadSessions(project) {' +
    'const params = new URLSearchParams();' +
    "params.set('limit', '50');" +
    'if (project) params.set("project", project);' +
    'const res = await fetch(apiBase + "/api/sessions?" + params.toString());' +
    'if (!res.ok) return;' +
    'const data = await res.json();' +
    'renderSessions(data);' +
  '}');
  htmlParts.push('async function loadObservations(sessionId) {' +
    'const res = await fetch(apiBase + "/api/sessions/" + sessionId + "/observations");' +
    'if (!res.ok) return;' +
    'const data = await res.json();' +
    'renderObservations(sessionId, data);' +
  '}');
  htmlParts.push('function renderSessions(sessions) {' +
    'const container = document.getElementById("sessions");' +
    'container.innerHTML = "";' +
    'if (!sessions.length) {' +
      'container.innerHTML = "<p class=\"muted\">No sessions found yet.</p>";' +
      'return;' +
    '}' +
    'sessions.forEach(function (s) {' +
      'const div = document.createElement("div");' +
      'div.className = "session";' +
      'div.dataset.id = String(s.id);' +
      'var projectName = escapeHtml(s.project || "unknown");' +
      'var started = escapeHtml(s.started_at || "");' +
      'div.innerHTML = "<div class=\\"session-project\\">" + projectName + "</div>" +' +
        '"<div class=\\"session-meta\\">ID " + s.id + " | Started: " + started + "</div>";' +
      'div.addEventListener("click", function () {' +
        'document.querySelectorAll(".session").forEach(function (el) { el.classList.remove("active"); });' +
        'div.classList.add("active");' +
        'loadObservations(s.id);' +
      '});' +
      'container.appendChild(div);' +
    '});' +
  '}');
  htmlParts.push('function renderObservations(sessionId, observations) {' +
    'const title = document.getElementById("sessionTitle");' +
    'if (title) title.textContent = "Session " + sessionId;' +
    'const meta = document.getElementById("sessionMeta");' +
    'if (meta) meta.textContent = String(observations.length) + " observations";' +
    'const container = document.getElementById("observations");' +
    'if (!container) return;' +
    'container.innerHTML = "";' +
    'if (!observations.length) {' +
      'container.innerHTML = "<p class=\"muted\">No observations yet.</p>";' +
      'return;' +
    '}' +
    'observations.forEach(function (o) {' +
      'const div = document.createElement("div");' +
      'div.className = "obs";' +
      'var type = escapeHtml(o.type || "");' +
      'var created = escapeHtml(o.created_at || "");' +
      'var content = escapeHtml(o.content || "");' +
      'div.innerHTML = "<div class=\\"obs-header\\">" +' +
        '"<span class=\\"obs-type\\">" + type + "</span>" +' +
        '"<span>" + created + "</span>" +' +
        '"</div>" +' +
        '"<div class=\\"obs-content\\">" + content + "</div>";' +
      'container.appendChild(div);' +
    '});' +
  '}');
  htmlParts.push('function escapeHtml(str) {' +
    'return String(str)' +
      '.replace(/&/g, "&amp;")' +
      '.replace(/</g, "&lt;")' +
      '.replace(/>/g, "&gt;")' +
      '.replace(/"/g, "&quot;")' +
      ".replace(/'/g, '&#39;');" +
  '}');
  htmlParts.push('var projectFilter = document.getElementById("projectFilter");' +
    'if (projectFilter) {' +
      'projectFilter.addEventListener("input", function (e) {' +
        'var target = e.target || e.srcElement;' +
        'var value = (target && target.value) ? target.value.trim() : "";' +
        'loadSessions(value || undefined);' +
      '});' +
    '}');
  htmlParts.push('loadSessions();');
  htmlParts.push('</script>');
  htmlParts.push('</body>');
  htmlParts.push('</html>');
  return htmlParts.join('');
}
