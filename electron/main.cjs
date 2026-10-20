const { app, BrowserWindow, ipcMain, dialog, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'webm', 'mp4'];

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1050,
    minHeight: 620,
    backgroundColor: '#100e1a',
    title: 'MixTape',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Externe Links im Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  const allowed = new Set(['media', 'microphone', 'audioCapture']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ------------------------------------------------------------------ */
/* Hilfsfunktionen                                                     */
/* ------------------------------------------------------------------ */

function mixtapeDir(sub) {
  const dir = path.join(app.getPath('music'), 'MixTape', sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Dateien                                                             */
/* ------------------------------------------------------------------ */

ipcMain.handle('dialog:openAudio', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Audiodateien importieren',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Audio', extensions: AUDIO_EXT },
      { name: 'Alle Dateien', extensions: ['*'] },
    ],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('file:read', async (_e, p) => {
  try {
    return await fsp.readFile(p);
  } catch {
    return null;
  }
});

ipcMain.handle('source:resolve', async (_e, { path: abs, relPath, projectPath }) => {
  const candidates = [];
  if (projectPath && relPath) candidates.push(path.resolve(path.dirname(projectPath), relPath));
  if (abs) candidates.push(abs);
  for (const c of candidates) if (await exists(c)) return c;
  return null;
});

ipcMain.handle('recording:save', async (_e, { data, ext }) => {
  const file = path.join(mixtapeDir('Aufnahmen'), `Aufnahme_${timestamp()}.${ext || 'webm'}`);
  await fsp.writeFile(file, Buffer.from(data));
  return file;
});

ipcMain.handle('file:writeText', async (_e, { path: p, text }) => {
  await fsp.writeFile(p, text, 'utf8');
  return true;
});

ipcMain.handle('shell:showItem', (_e, p) => shell.showItemInFolder(p));

/* ------------------------------------------------------------------ */
/* Projekte                                                            */
/* ------------------------------------------------------------------ */

/** Liste der zuletzt geöffneten/gespeicherten Projekte (neueste zuerst). */
const RECENT_MAX = 3;
const recentFile = () => path.join(app.getPath('userData'), 'recent-projects.json');

async function readRecent() {
  try {
    const list = JSON.parse(await fsp.readFile(recentFile(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function touchRecent(p, title) {
  const list = (await readRecent()).filter((r) => path.resolve(r.path).toLowerCase() !== path.resolve(p).toLowerCase());
  list.unshift({ path: p, title: title || path.basename(p, path.extname(p)), openedAt: Date.now() });
  await fsp.writeFile(recentFile(), JSON.stringify(list.slice(0, 10), null, 2), 'utf8').catch(() => {});
}

ipcMain.handle('recent:list', async () => {
  const out = [];
  for (const r of await readRecent()) {
    if (out.length >= RECENT_MAX) break;
    if (await exists(r.path)) out.push(r);
  }
  return out;
});

ipcMain.handle('project:save', async (_e, { data, path: current, saveAs }) => {
  let target = current;
  if (!target || saveAs) {
    const res = await dialog.showSaveDialog(win, {
      title: 'Projekt speichern',
      defaultPath: current || path.join(mixtapeDir('Projekte'), `${data.doc.title || 'Mixtape'}.mixtape`),
      filters: [{ name: 'MixTape-Projekt', extensions: ['mixtape'] }],
    });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  // Relative Pfade ergänzen, damit Projekt + Audiodateien zusammen verschoben werden können
  const dir = path.dirname(target);
  data.sources = data.sources.map((s) => ({ ...s, relPath: s.path ? path.relative(dir, s.path) : undefined }));
  await fsp.writeFile(target, JSON.stringify(data, null, 2), 'utf8');
  await touchRecent(target, data.doc?.title);
  return target;
});

async function loadProject(p) {
  const data = JSON.parse(await fsp.readFile(p, 'utf8'));
  await touchRecent(p, data.doc?.title);
  return { path: p, data };
}

ipcMain.handle('project:open', async (_e, p) => {
  if (p) return loadProject(p);
  const res = await dialog.showOpenDialog(win, {
    title: 'Projekt öffnen',
    defaultPath: mixtapeDir('Projekte'),
    properties: ['openFile'],
    filters: [{ name: 'MixTape-Projekt', extensions: ['mixtape', 'json'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  return loadProject(res.filePaths[0]);
});

/* ------------------------------------------------------------------ */
/* Sound-Liste (projektübergreifend)                                   */
/* ------------------------------------------------------------------ */

const libraryFile = () => path.join(app.getPath('userData'), 'sound-library.json');

ipcMain.handle('library:get', async () => {
  let list = [];
  try {
    list = JSON.parse(await fsp.readFile(libraryFile(), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return Promise.all(list.map(async (s) => ({ ...s, missing: !(await exists(s.path)) })));
});

ipcMain.handle('library:set', async (_e, list) => {
  const clean = list.map(({ missing, ...s }) => s);
  await fsp.writeFile(libraryFile(), JSON.stringify(clean, null, 2), 'utf8');
  return true;
});

/* ------------------------------------------------------------------ */
/* Export (Streaming in Datei)                                         */
/* ------------------------------------------------------------------ */

const streams = new Map();
let streamId = 0;

ipcMain.handle('export:choose', async (_e, { defaultName, ext }) => {
  const names = { mp3: 'MP3-Audio', wav: 'WAV-Audio', pdf: 'PDF-Dokument' };
  const res = await dialog.showSaveDialog(win, {
    title: 'Exportieren',
    defaultPath: path.join(mixtapeDir('Export'), `${defaultName}.${ext}`),
    filters: [{ name: names[ext] || ext.toUpperCase(), extensions: [ext] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('stream:open', async (_e, p) => {
  const handle = await fsp.open(p, 'w');
  const id = ++streamId;
  streams.set(id, handle);
  return id;
});

ipcMain.handle('stream:write', async (_e, { id, data }) => {
  const handle = streams.get(id);
  if (!handle) throw new Error('Stream nicht geöffnet');
  await handle.write(Buffer.from(data));
  return true;
});

ipcMain.handle('stream:close', async (_e, id) => {
  const handle = streams.get(id);
  if (handle) await handle.close();
  streams.delete(id);
  return true;
});

/* ------------------------------------------------------------------ */
/* J-Card als PDF                                                      */
/* ------------------------------------------------------------------ */

ipcMain.handle('jcard:pdf', async (_e, { html, defaultName }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Kassetten-Einleger speichern',
    defaultPath: path.join(mixtapeDir('Export'), `${defaultName}.pdf`),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const tmp = path.join(app.getPath('temp'), `mixtape-jcard-${Date.now()}.html`);
  await fsp.writeFile(tmp, html, 'utf8');
  const pdfWin = new BrowserWindow({ show: false });
  try {
    await pdfWin.loadFile(tmp);
    const pdf = await pdfWin.webContents.printToPDF({
      pageSize: 'A4',
      landscape: true,
      printBackground: true,
      margins: { marginType: 'none' },
    });
    await fsp.writeFile(res.filePath, pdf);
  } finally {
    pdfWin.destroy();
    fsp.unlink(tmp).catch(() => {});
  }
  return res.filePath;
});

/* ------------------------------------------------------------------ */
/* YouTube-Import via yt-dlp                                           */
/* ------------------------------------------------------------------ */

const YTDLP_ASSET = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp' }[process.platform] || 'yt-dlp';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = '';
    let err = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts });
    } catch (e) {
      resolve({ code: -1, out, err: String(e) });
      return;
    }
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ code: -1, out, err: String(e) }));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

async function onPath(cmd) {
  const r = await run(cmd, ['--version']);
  return r.code === 0;
}

async function ensureYtDlp(report) {
  if (await onPath('yt-dlp')) return 'yt-dlp';
  const binDir = path.join(app.getPath('userData'), 'bin');
  const bin = path.join(binDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (await exists(bin)) {
    // yt-dlp regelmäßig aktualisieren – YouTube ändert sich oft
    const age = Date.now() - (await fsp.stat(bin)).mtimeMs;
    if (age > 7 * 24 * 3600 * 1000) {
      report({ status: 'Aktualisiere yt-dlp …', percent: null });
      await run(bin, ['-U']);
      await fsp.utimes(bin, new Date(), new Date()).catch(() => {});
    }
    return bin;
  }
  report({ status: 'Lade yt-dlp herunter (einmalig) …', percent: null });
  await fsp.mkdir(binDir, { recursive: true });
  const res = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_ASSET}`);
  if (!res.ok) throw new Error(`yt-dlp konnte nicht geladen werden (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(bin, buf);
  if (process.platform !== 'win32') await fsp.chmod(bin, 0o755);
  return bin;
}

ipcMain.handle('youtube:download', async (e, url) => {
  const report = (p) => e.sender.send('youtube:progress', p);
  const bin = await ensureYtDlp(report);
  const outDir = mixtapeDir('YouTube');

  // yt-dlp braucht für YouTube eine JavaScript-Runtime. Node aus dem PATH oder Electron selbst als Node.
  const hasNode = await onPath('node');
  const jsRuntime = hasNode ? 'node' : `node:${process.execPath}`;
  const env = hasNode ? process.env : { ...process.env, ELECTRON_RUN_AS_NODE: '1' };

  const baseArgs = [
    url,
    '--no-playlist',
    '-f', 'bestaudio[ext=m4a]/bestaudio/best',
    '-o', path.join(outDir, '%(title).90B [%(id)s].%(ext)s'),
    '--windows-filenames',
    '--no-mtime',
    '--no-simulate',
    '--progress',
    '--newline',
    '--print', 'before_dl:MIXTAPE_TITLE:%(title)s',
    '--print', 'after_move:MIXTAPE_FILE:%(filepath)s',
  ];

  const attempt = (args) =>
    new Promise((resolve, reject) => {
      report({ status: 'Starte Download …', percent: 0 });
      const child = spawn(bin, args, { windowsHide: true, env });
      let title = null;
      let file = null;
      let stderr = '';
      let buf = '';
      const onLine = (line) => {
        const m = line.match(/\[download\]\s+([\d.]+)%/);
        if (m) report({ status: title ? `Lade „${title}“ …` : 'Lade Audio …', percent: parseFloat(m[1]) });
        if (line.startsWith('MIXTAPE_TITLE:')) title = line.slice(14).trim();
        if (line.startsWith('MIXTAPE_FILE:')) file = line.slice(13).trim();
      };
      child.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(onLine);
      });
      child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
      child.on('error', reject);
      child.on('close', (code) => {
        if (buf) onLine(buf);
        if (code === 0 && file) resolve({ path: file, title: title || path.basename(file) });
        else {
          const err = new Error(stderr.split('\n').filter((l) => l.includes('ERROR')).join('\n') || stderr.trim() || `yt-dlp beendet mit Code ${code}`);
          err.stderr = stderr;
          reject(err);
        }
      });
    });

  try {
    return await attempt([...baseArgs, '--js-runtimes', jsRuntime]);
  } catch (err) {
    // Ältere yt-dlp-Versionen kennen --js-runtimes nicht
    if (/no such option/i.test(err.stderr || '')) return attempt(baseArgs);
    throw err;
  }
});
