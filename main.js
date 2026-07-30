const { app, BrowserWindow, ipcMain } = require('electron');
const http = require('http');
const path = require('path');

const PORT = 7829;
let mainWindow;

// ─── Local HTTP server ─────────────────────────────────────────────────────
// The bookmarklet on the chunk picker page POSTs to this endpoint.
// We forward the data to the renderer via IPC.
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/chunk-data') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (mainWindow) {
          mainWindow.webContents.send('chunk-data', data);
          mainWindow.focus();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1');

// ─── Auto-fetch chunk data via hidden window ────────────────────────────────
// Loads the chunk picker URL in an invisible window, waits for baseChunkData
// to be available, extracts the keys, then destroys the window.
ipcMain.handle('fetch-chunk-data', async (_event, url) => {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: false,   // needed so executeJavaScript can reach page globals
        webSecurity: true,
      },
    });

    const TIMEOUT_MS = 30000;
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      try { win.destroy(); } catch { /* already gone */ }
      result instanceof Error ? reject(result) : resolve(result);
    };

    const timer = setTimeout(() => done(new Error('Timed out waiting for chunk data')), TIMEOUT_MS);

    let lastCount = -1;
    let stableFor = 0;
    const STABLE_NEEDED = 3; // must be the same count 3 polls in a row (~1.8s)

    const poll = setInterval(async () => {
      try {
        const raw = await win.webContents.executeJavaScript(`
          (function() {
            if (typeof baseChunkData === 'undefined') return null;
            var items    = Object.keys(baseChunkData.items    || {});
            var npcs     = Object.keys(baseChunkData.npcs     || {});
            var monsters = Object.keys(baseChunkData.monsters || {});
            if (items.length === 0 && npcs.length === 0 && monsters.length === 0) return null;
            return JSON.stringify({ items: items, npcs: npcs, monsters: monsters });
          })()
        `);
        if (!raw) { lastCount = -1; stableFor = 0; return; }

        const parsed = JSON.parse(raw);
        const count  = parsed.items.length + parsed.npcs.length + parsed.monsters.length;

        if (count === lastCount) {
          stableFor++;
          if (stableFor >= STABLE_NEEDED) {
            // Data is stable — grab uncompleted tasks from the same page in one shot
            try {
              const tasks = await win.webContents.executeJavaScript(`
                (function() {
                  var labels = document.querySelectorAll(
                    '.panel.panel-active .challenge:has(input[type="checkbox"]:not([checked])) .radio__label'
                  );
                  return Array.from(labels, function(el) { return el.textContent.trim(); });
                })()
              `);
              parsed.tasks = tasks;
            } catch (e) {
              parsed.tasks = [];
            }
            done(parsed);
          }
        } else {
          lastCount = count;
          stableFor = 1;
        }
      } catch { /* page not ready yet, keep polling */ }
    }, 600);

    win.webContents.on('did-fail-load', (_e, code, desc) => done(new Error(`Page failed to load: ${desc}`)));
    win.loadURL(url);
  });
});

// ─── App window ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 700,
    minHeight: 600,
    title: 'OSRS Chunk Roller',
    backgroundColor: '#100c06',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  server.close();
  app.quit();
});
