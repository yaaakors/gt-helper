// Оболочка: окно, связь экрана с модулями, обновления. Вся логика — в папке core (от окна не зависит).
'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./core/store');
const { Journal } = require('./core/journal');
const { Tasks } = require('./core/tasks');
const { TileChat } = require('./core/tiles/scenario');
const source = require('./core/tiles/source');
const gsheet = require('./core/tiles/gsheet');
const crypto = require('crypto');
const folders = require('./core/tiles/folders');
const gemini = require('./core/ai/gemini');
const themes = require('./core/themes');

if (process.env.GT_USER_DIR) app.setPath('userData', process.env.GT_USER_DIR); // для проверок
if (!app.requestSingleInstanceLock()) app.quit();

let win; let store; let journal; let tasks; let chat; let update = { state: 'idle' };

const crypt = {
  encrypt: (s) => (safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : 'raw:' + s),
  decrypt: (s) => (s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : s.replace(/^raw:/, '')),
};
const ai = {
  ready: () => !!store.geminiKey,
  json: (system, user) => gemini.json({ key: store.geminiKey, model: store.get('geminiModel'), system, user }),
};

// ---------- переписка: храним последние сообщения ----------
function history() { return store.read('chat.json', { messages: [] }).messages; }
function remember(list) {
  const all = history().concat(list);
  for (const m of list) if (m.planUpdate) { const src = all.find((x) => x.plan && x.plan.id === m.planUpdate.id); if (src) src.plan.status = m.planUpdate.status; }
  store.write('chat.json', { messages: all.slice(-300) });
  return list;
}
/** Миниатюра картинки. В Windows берём готовую у системы (быстро даже для больших файлов с сети). */
async function thumb(file, height) {
  try { const t = await nativeImage.createThumbnailFromPath(file, { width: Math.round(height * 1.6), height }); if (!t.isEmpty()) return 'data:image/jpeg;base64,' + t.toJPEG(80).toString('base64'); } catch { /* нет системной миниатюры — сделаем сами */ }
  try { const img = nativeImage.createFromPath(file); if (!img.isEmpty()) return 'data:image/jpeg;base64,' + img.resize({ height: Math.min(height, img.getSize().height) }).toJPEG(78).toString('base64'); } catch { /* не картинка */ }
  return '';
}
/** Ответы чата с картинками: дорисовываем миниатюры (сам чат про окно и картинки ничего не знает) */
async function decorate(list) {
  for (const m of list) {
    if (m.gallery) for (const it of m.gallery.items) it.thumb = await thumb(it.path, 200);
    if (m.card && m.card.photo) m.card.photoThumb = await thumb(m.card.photo, 200);
  }
  return list;
}
const userMsg = (text, files) => ({ id: 'u' + Date.now().toString(36), from: 'user', time: new Date().toISOString(), text, files: files && files.length ? files : undefined });
/** Описание приложенного файла для переписки (у картинок — маленькая миниатюра) */
function attachment(file, height = 96) {
  const a = { name: path.basename(file), path: file, kind: /\.(jpe?g|png|webp|bmp)$/i.test(file) ? 'image' : /\.(xlsx?|xlsm|csv)$/i.test(file) ? 'excel' : 'file' };
  if (a.kind === 'image') { try { const img = nativeImage.createFromPath(file); if (!img.isEmpty()) a.thumb = 'data:image/jpeg;base64,' + img.resize({ height: Math.min(height, img.getSize().height) }).toJPEG(78).toString('base64'); } catch { /* без миниатюры */ } }
  return a;
}

// ---------- обновления ----------
function sendUpdate(patch) { update = Object.assign({}, update, patch); if (win && !win.isDestroyed()) win.webContents.send('update', update); }
let updater = null;
function setupUpdater() {
  if (!app.isPackaged) { update = { state: 'dev' }; return; }
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;           // новая версия скачивается сама, в фоне
    updater.autoInstallOnAppQuit = true;   // и ставится при закрытии программы, если не нажали «Перезапустить»
    updater.on('checking-for-update', () => sendUpdate({ state: 'checking', error: '' }));
    updater.on('update-available', (i) => sendUpdate({ state: 'available', version: i.version }));
    updater.on('update-not-available', () => sendUpdate({ state: 'latest', checked: new Date().toISOString() }));
    updater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
    updater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version }));
    updater.on('error', (e) => sendUpdate({ state: 'error', error: String((e && e.message) || e).split('\n')[0].slice(0, 200) }));
    setTimeout(() => updater.checkForUpdates().catch(() => {}), 4000);
    setInterval(() => updater.checkForUpdates().catch(() => {}), 4 * 3600 * 1000);
  } catch (e) { update = { state: 'error', error: String(e.message || e) }; }
}

// ---------- состояние настроек для экрана ----------
async function status() {
  const out = { sheet: { ok: false, text: 'не указан' }, root: { ok: false, text: 'не указана' }, ai: { ok: ai.ready(), text: ai.ready() ? 'ключ сохранён' : 'ключ не задан — сообщения разбирает скрипт' } };
  if (source.configured(store)) {
    try {
      const m = await source.load(store);
      out.sheet = { ok: true, text: source.kind(store) === 'db' ? `база: артикулов — ${m.rows.length}, коллекций — ${new Set(m.rows.map((r) => r.collection)).size}` : source.isGoogle(store) ? `подключена: «${m.docName}», лист «${m.sheetName}», артикулов — ${m.rows.length}` : `прочитан: лист «${m.sheetName}», артикулов — ${m.rows.length}` };
      if (source.isGoogle(store) && m.scriptVersion < gsheet.SCRIPT_VERSION) out.sheet = { ok: false, text: 'В таблице старая версия скрипта — скопируйте скрипт заново и обновите развёртывание' };
    } catch (e) { out.sheet = { ok: false, text: String(e.message || e) }; }
  }
  if (store.get('catalogRoot')) {
    const ix = await folders.index(store.get('catalogRoot'));
    if (!ix) out.root = { ok: false, text: 'недоступна (нет сети или неверный путь)' };
    else {
      // бренды — только те папки, что совпали с ТМ из файла характеристик (остальные папки — не бренды)
      let found = [];
      try { const m = await source.load(store); found = [...new Set((m.vocab.tm || []).map((tm) => folders.matchBrand(tm, ix.tops, store.get('brandFolders'))).filter(Boolean))].sort(); } catch { /* файл не задан */ }
      out.root = { ok: true, text: (found.length ? `доступна. Папки брендов: ${found.join(', ')}` : `доступна, папок внутри — ${ix.tops.length}`) + `. Папок коллекций найдено — ${ix.map.size}` };
    }
  }
  return out;
}

// ---------- папка данных ----------
// Папку программы установщик стирает при каждом обновлении — данные в ней хранить нельзя.
const installDir = () => path.dirname(process.execPath);
function inside(dir, parent) { const r = path.relative(path.resolve(parent), path.resolve(dir)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); }
const unsafeDataDir = (dir) => !!dir && app.isPackaged && inside(dir, installDir());
/** Скопировать данные в новую папку, ничего не затирая */
function copyData(from, to) {
  try { if (from && fs.existsSync(from) && path.resolve(from) !== path.resolve(to)) fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false }); return true; } catch { return false; }
}

// ---------- оформление ----------
const look = () => themes.describe(store.get('theme'), store.get('colors'));
function applyLook() {
  if (!win || win.isDestroyed()) return;
  const c = look().colors;
  try { win.setBackgroundColor(c.bg); win.setTitleBarOverlay({ color: c.bg, symbolColor: c.muted, height: 40 }); } catch { /* кнопки окна перекрашиваются только в Windows */ }
}

function handlers() {
  const h = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
    try { return await fn(...args); } catch (e) {
      journal.add('error', `${name}: ${e.message || e}`, { stack: String(e.stack || '').split('\n').slice(0, 4) });
      throw e;
    }
  });
  h('app:info', () => ({ version: app.getVersion(), update, firstRun: !source.configured(store), look: look() }));

  h('chat:history', () => history().map((m) => { if (m.plan && ['pending', 'failed'].includes(m.plan.status) && !chat.plans.has(m.plan.id)) m.plan.status = 'expired'; return m; }));
  h('chat:send', async (text, files) => {
    const paths = (Array.isArray(files) ? files : []).map(String).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }).slice(0, 30);
    const u = userMsg(text, paths.map(attachment)); remember([u]);
    return [u].concat(remember(await decorate(await chat.handle(text, paths))));
  });
  h('files:info', (paths) => (Array.isArray(paths) ? paths : []).map(String).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } }).slice(0, 30)
    .map((f) => Object.assign(attachment(f, 360), { size: fs.statSync(f).size }))); // для окна отправки: превью покрупнее
  h('files:pick', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] }); return r.canceled ? [] : r.filePaths; });
  h('files:paste', (name, data) => { // картинка, вставленная из буфера: сохраняем во «входящие» папки данных
    const dir = store.file('inbox'); fs.mkdirSync(dir, { recursive: true });
    const safe = String(name || 'вставка.png').replace(/[<>:"/\\|?*]/g, '_').slice(-80);
    const to = path.join(dir, Date.now().toString(36) + '-' + safe);
    fs.writeFileSync(to, Buffer.from(data)); return to;
  });
  h('chat:execute', async (planId, opts) => remember(await chat.execute(planId, opts)));
  h('chat:cancel', (planId) => remember(chat.cancel(planId)));
  h('chat:clear', () => { store.write('chat.json', { messages: [] }); return true; });
  h('chat:feedback', (msgId, comment) => {
    const all = history(); const i = all.findIndex((m) => m.id === msgId);
    const ctx = all.slice(Math.max(0, i - 3), i + 1).map((m) => ({ from: m.from, text: m.text, plan: m.plan ? (m.plan.raw || m.plan.changes) : undefined, results: m.results }));
    journal.add('feedback', comment || 'Ответ не такой, как ожидалось', { context: ctx }); return true;
  });

  h('tasks:list', () => tasks.list());
  h('tasks:add', (text) => tasks.add(text));
  h('tasks:toggle', (id) => tasks.toggle(id));
  h('tasks:move', (id, beforeId) => tasks.move(id, beforeId));
  h('tasks:edit', (id, text) => tasks.edit(id, text));
  h('tasks:remove', (id) => tasks.remove(id));
  h('tasks:report', (filter) => tasks.report(filter));
  h('tasks:export', async (filter) => {
    const d = new Date(); const name = `Отчёт по задачам ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.xlsx`;
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || !r.filePath) return null;
    await tasks.exportXlsx(r.filePath, filter); shell.showItemInFolder(r.filePath); return r.filePath;
  });
  h('clipboard:write', (text) => { clipboard.writeText(String(text)); return true; });

  h('journal:list', () => journal.list());
  h('journal:add', (text) => journal.add('idea', text));
  h('journal:open', () => { if (!fs.existsSync(journal.file)) fs.writeFileSync(journal.file, ''); shell.showItemInFolder(journal.file); return true; });

  h('settings:get', () => ({ settings: store.publicSettings(), look: look() })); // сразу, без проверок
  h('settings:status', () => status());                                               // проверки связи — отдельно, они медленные
  h('settings:set', (patch) => {
    let error = '';
    if ('dataDir' in patch) {
      const next = String(patch.dataDir || '').trim();
      if (unsafeDataDir(next)) { error = 'Эту папку выбрать нельзя: она внутри папки программы, а её установщик стирает при каждом обновлении. Выберите другую, например в «Документах».'; delete patch.dataDir; } else {
        const old = store.dataDir; store.set({ dataDir: next });
        if (!copyData(old, store.dataDir)) error = 'Папку поменял, но перенести в неё данные не получилось — скопируйте файлы вручную из ' + old;
        delete patch.dataDir;
      }
    }
    store.set(patch);
    if ('theme' in patch || 'colors' in patch) applyLook();
    return { settings: store.publicSettings(), look: look(), error };
  });
  h('settings:clearKey', () => { store.clearKey(); return { settings: store.publicSettings(), look: look() }; });
  h('settings:pick', async (kind) => {
    const opt = kind === 'sheetPath'
      ? { properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx'] }] }
      : { properties: ['openDirectory', 'createDirectory'] };
    const cur = store.get(kind); if (cur) opt.defaultPath = cur;
    const r = await dialog.showOpenDialog(win, opt);
    return r.canceled ? null : r.filePaths[0];
  });
  h('settings:checkAi', async (key) => {
    const k = (key || '').trim() || store.geminiKey;
    if (!k) return { ok: false, text: 'Сначала вставьте ключ' };
    try {
      const models = await gemini.check(k);
      const has = models.includes(store.get('geminiModel'));
      return { ok: true, text: `Ключ работает, доступно моделей: ${models.length}.` + (has ? '' : ` Модели «${store.get('geminiModel')}» в списке нет — выберите другую.`), models: has ? [] : models.filter((m) => /flash/i.test(m)).slice(0, 12) };
    } catch (e) { return { ok: false, text: 'Не получилось: ' + (e.message || e) }; }
  });
  // ---------- база ----------
  h('db:info', () => { const d = source.db(store); return { count: d.count(), imported: d.meta('imported'), file: d.file }; });
  h('db:import', async (from) => {
    const d = source.db(store);
    if (d.count()) throw new Error('В базе уже есть данные — перенос делается один раз');
    const m = await source.loadFrom(store, from);
    const n = d.importModel(m, 'Вит', from === 'google' ? 'перенос из Google Таблицы' : 'перенос из Excel');
    d.backup(store.file('backups'));
    store.set({ source: 'db' });
    return { count: n };
  });
  h('db:export', async () => {
    const d = new Date(); const name = `Характеристики из базы ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.xlsx`;
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('documents'), name), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || !r.filePath) return null;
    await source.db(store).exportXlsx(r.filePath); shell.showItemInFolder(r.filePath); return r.filePath;
  });
  h('gs:script', () => {
    if (!store.get('gsToken')) store.set({ gsToken: crypto.randomBytes(24).toString('hex') });
    clipboard.writeText(gsheet.script(store.get('gsToken'), fs.readFileSync(path.join(__dirname, 'google', 'Code.gs'), 'utf8')));
    return true;
  });
  h('shell:open', (p) => shell.openPath(String(p)));

  h('update:check', async () => { if (updater) await updater.checkForUpdates().catch(() => {}); return update; });
  h('update:download', async () => { if (updater) updater.downloadUpdate().catch(() => {}); return true; });
  h('update:install', () => { if (updater) setImmediate(() => updater.quitAndInstall(true, true) /* тихо, без окна установщика, и сразу открыть программу снова */); return true; });
}

function createWindow() {
  const c = look().colors;
  win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 860, minHeight: 560, backgroundColor: c.bg, show: false,
    titleBarStyle: 'hidden', titleBarOverlay: { color: c.bg, symbolColor: c.muted, height: 40 },
    title: 'GT Помощник', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

app.whenReady().then(() => {
  store = new Store(app.getPath('userData'), crypt);
  if (unsafeDataDir(store.get('dataDir'))) { // старая ошибка: данные внутри папки программы — уводим в безопасное место
    const old = store.get('dataDir'); store.set({ dataDir: '' }); copyData(old, store.dataDir);
  }
  journal = new Journal(store, app.getVersion());
  tasks = new Tasks(store);
  chat = new TileChat({ store, journal, tasks, ai });
  process.on('uncaughtException', (e) => journal.add('error', String(e.message || e), { stack: String(e.stack || '').split('\n').slice(0, 5) }));
  process.on('unhandledRejection', (e) => journal.add('error', String((e && e.message) || e)));
  handlers(); createWindow(); setupUpdater();
  setTimeout(() => { folders.index(store.get('catalogRoot')).catch(() => {}); }, 1500);
  if (source.kind(store) === 'db') { try { source.db(store).backup(store.file('backups')); } catch (e) { journal.add('error', 'Копия базы: ' + (e.message || e)); } } // копия базы при запуске (одна на день)
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
