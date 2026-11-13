// Файл характеристик (Excel): чтение, справочники значений, добавление и правка строк.
// Перед каждой записью делается копия. Запись проверяется повторным чтением.
'use strict';
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

// Поля программы -> как узнать колонку по заголовку (маленькими буквами)
const FIELDS = [
  ['article', (h) => h === 'артикул'], ['tm', (h) => h === 'тм'], ['collection', (h) => h === 'колекція'],
  ['decor', (h) => h === 'назва декору'], ['purpose', (h) => h === 'призначення'], ['usage', (h) => h === 'застосування'],
  ['type', (h) => h === 'тип'], ['format', (h) => h === 'формат'], ['thickness', (h) => h.startsWith('товщина')],
  ['rect', (h) => h === 'ректифікат'], ['colorGroup', (h) => h === 'група кольору'], ['color', (h) => h === 'колір'],
  ['surface', (h) => h === 'поверхня'], ['relief', (h) => h === 'рельєф'], ['frost', (h) => h === 'морозостійкість'],
  ['design', (h) => h === 'тип дизайну'], ['pei', (h) => h.includes('(pei)')], ['ptv', (h) => h.includes('(ptv)')],
  ['r', (h) => h.includes('(r)')], ['ean', (h) => h.startsWith('штрихкод')], ['status', (h) => h === 'актуальність'],
  ['year', (h) => h.startsWith('рік випуску')], ['month', (h) => h.startsWith('місяць випуску')], ['comment', (h) => h === 'коментар'],
  // упаковка
  ['pcs', (h) => h.startsWith('шт в упаков')], ['m2pack', (h) => h.startsWith('м² в упаков') || h.startsWith('м2 в упаков')], ['w1', (h) => h.startsWith('вага 1 м')],
  ['wpack', (h) => h.startsWith('вага упаковки')], ['packsPal', (h) => h.startsWith('упаковок на палет')], ['m2pal', (h) => h.startsWith('м² на палет') || h.startsWith('м2 на палет')],
  ['wpal', (h) => h.startsWith('вага палет')],
  ['packNote', (h) => h.startsWith('упаковка: прим')],
];
const NUMERIC = new Set(['thickness', 'pei', 'year', 'month', 'pcs', 'm2pack', 'w1', 'wpack', 'packsPal', 'm2pal', 'wpal']);
// Поля, где значение должно быть из уже существующих в файле
const CLOSED = ['tm', 'purpose', 'type', 'rect', 'color', 'surface', 'relief', 'frost', 'r', 'status'];

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return cellText(v.result);
    if (v.text) return String(v.text);
    if (v instanceof Date) return v.toISOString();
    if (v.error) return '';
    return '';
  }
  return String(v).trim();
}
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function locate(ws) {
  let headerRow = 0;
  for (let r = 1; r <= 6 && !headerRow; r++) if (norm(cellText(ws.getRow(r).getCell(1).value)) === 'артикул') headerRow = r;
  if (!headerRow) throw new Error('В файле не найдена строка заголовков (ячейка «Артикул» в первой колонке)');
  const cols = {}; const labels = {};
  ws.getRow(headerRow).eachCell((c, i) => {
    const raw = cellText(c.value); const h = norm(raw);
    for (const [key, test] of FIELDS) if (!cols[key] && test(h)) { cols[key] = i; labels[key] = raw.split('\n')[0].trim(); }
  });
  for (const need of ['article', 'tm', 'collection']) if (!cols[need]) throw new Error(`В файле нет колонки для поля «${need}»`);
  let last = headerRow;
  for (let r = ws.rowCount; r > headerRow; r--) if (cellText(ws.getRow(r).getCell(cols.article).value)) { last = r; break; }
  return { headerRow, cols, labels, last };
}

async function open(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('В файле нет листов');
  return { wb, ws, info: locate(ws) };
}

function majority(map) { // {ключ: {значение: сколько}} -> {ключ: самое частое}
  const out = {};
  for (const [k, counts] of Object.entries(map)) out[k] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  return out;
}

/**
 * Собрать модель из сетки значений (общая для Excel и Google Таблицы).
 * grid — строки листа, начиная с первой; colorRows — строки листа «Кольори» (с заголовком).
 */
function modelFromGrid(grid, colorRows, meta) {
  const text = (r, c) => cellText(grid[r - 1] ? grid[r - 1][c - 1] : null);
  let headerRow = 0;
  for (let r = 1; r <= 6 && !headerRow; r++) if (norm(text(r, 1)) === 'артикул') headerRow = r;
  if (!headerRow) throw new Error('Не найдена строка заголовков (ячейка «Артикул» в первой колонке)');
  const cols = {}; const labels = {};
  (grid[headerRow - 1] || []).forEach((v, i) => {
    const raw = cellText(v); const h = norm(raw);
    for (const [key, test] of FIELDS) if (!cols[key] && test(h)) { cols[key] = i + 1; labels[key] = raw.split('\n')[0].trim(); }
  });
  for (const need of ['article', 'tm', 'collection']) if (!cols[need]) throw new Error(`Нет колонки для поля «${need}»`);
  const rows = []; const byArticle = new Map(); const counts = {}; const collections = new Map();
  const rectVotes = {}; const frostVotes = {}; let last = headerRow;
  for (let r = headerRow + 1; r <= grid.length; r++) {
    const rec = { row: r };
    for (const [key, col] of Object.entries(cols)) rec[key] = text(r, col);
    if (!rec.article) continue;
    last = r;
    rows.push(rec); byArticle.set(rec.article.toLowerCase(), rec);
    for (const key of Object.keys(cols)) if (rec[key]) { (counts[key] = counts[key] || {})[rec[key]] = (counts[key][rec[key]] || 0) + 1; }
    if (rec.collection) {
      const c = collections.get(norm(rec.collection)) || { name: rec.collection, tm: {} };
      if (rec.tm) c.tm[rec.tm] = (c.tm[rec.tm] || 0) + 1;
      collections.set(norm(rec.collection), c);
    }
    if (rec.format && rec.type && rec.rect) { const k = rec.format + '|' + rec.type; (rectVotes[k] = rectVotes[k] || {})[rec.rect] = (rectVotes[k][rec.rect] || 0) + 1; }
    if (rec.type && rec.frost) (frostVotes[rec.type] = frostVotes[rec.type] || {})[rec.frost] = (frostVotes[rec.type][rec.frost] || 0) + 1;
  }
  // обычная длина артикула (в характеристиках — 5 знаков; заводской код длиннее на знак сорта)
  const lens = {}; for (const r of rows) lens[r.article.length] = (lens[r.article.length] || 0) + 1;
  const articleLen = Number((Object.entries(lens).sort((a, b) => b[1] - a[1])[0] || [5])[0]);
  const vocab = {};
  for (const [key, c] of Object.entries(counts)) vocab[key] = Object.entries(c).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const colors = {}; // колір -> група
  (colorRows || []).forEach((row, i) => { if (i > 0) { const c = cellText(row[0]); if (c) colors[c] = cellText(row[1]); } });
  // Составные значения («мармур, геометрія») -> отдельные слова
  const parts = (key) => [...new Set((vocab[key] || []).flatMap((v) => v.split(',').map((x) => x.trim())).filter(Boolean))];
  return Object.assign({
    headerRow, last, labels, cols, rows, byArticle, collections, vocab, colors, articleLen,
    designParts: parts('design'), usageParts: parts('usage'),
    rectRule: majority(rectVotes), frostRule: majority(frostVotes),
  }, meta);
}

let cache = null;
/** Прочитать файл: строки, справочники, правила. Повторно читает только если файл изменился. */
async function load(file) {
  if (!file) throw new Error('Не указан файл характеристик (Настройки)');
  if (!fs.existsSync(file)) throw new Error('Файл характеристик не найден: ' + file);
  const mtime = fs.statSync(file).mtimeMs;
  if (cache && cache.file === file && cache.mtime === mtime) return cache;
  const { wb, ws } = await open(file);
  const sheetGrid = (sh) => { const g = []; sh.eachRow({ includeEmpty: true }, (row, i) => { const line = []; row.eachCell({ includeEmpty: true }, (c, j) => { line[j - 1] = c.value; }); g[i - 1] = line; }); return g; };
  const cs = wb.worksheets.find((x) => norm(x.name) === 'кольори');
  cache = modelFromGrid(sheetGrid(ws), cs ? sheetGrid(cs) : [], { file, mtime, sheetName: ws.name, title: 'Файл характеристик' });
  return cache;
}

function backup(file, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  const ext = path.extname(file);
  const to = path.join(backupDir, path.basename(file, ext) + '_' + stamp + ext);
  fs.copyFileSync(file, to);
  // храним 40 последних копий
  const all = fs.readdirSync(backupDir).filter((f) => f.endsWith(ext)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 40))) { try { fs.unlinkSync(path.join(backupDir, old)); } catch { /* не страшно */ } }
  return to;
}

function assertWritable(file) {
  let fd;
  try { fd = fs.openSync(file, 'r+'); } catch (e) {
    if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw new Error('Файл характеристик сейчас открыт (в Excel?) или защищён от записи. Закройте его и повторите.');
    throw e;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function typed(key, value) {
  if (value === '' || value === null || value === undefined) return null;
  if (NUMERIC.has(key)) { const n = Number(String(value).replace(',', '.')); return Number.isFinite(n) ? n : String(value); }
  return String(value);
}

async function save(wb, file) {
  const tmp = file + '.gt-tmp';
  await wb.xlsx.writeFile(tmp);
  try { fs.renameSync(tmp, file); } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* */ }
    if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw new Error('Файл характеристик сейчас открыт (в Excel?). Закройте его и повторите.');
    throw e;
  }
  cache = null;
}

/** Добавить строки в конец. Оформление и формулы — как у последней строки. */
async function addRows(file, products, backupDir) {
  assertWritable(file);
  const copy = backup(file, backupDir);
  const { wb, ws, info } = await open(file);
  const existing = new Set();
  for (let r = info.headerRow + 1; r <= info.last; r++) existing.add(cellText(ws.getRow(r).getCell(info.cols.article).value).toLowerCase());
  for (const p of products) if (existing.has(String(p.article).toLowerCase())) throw new Error(`Артикул ${p.article} уже есть в файле`);
  let last = info.last;
  const added = [];
  for (const p of products) {
    const src = ws.getRow(last); const n = last + 1; const row = ws.getRow(n);
    src.eachCell({ includeEmpty: true }, (c, i) => {
      const t = row.getCell(i);
      t.style = c.style;
      const f = c.formula; // у новой строки та же формула, со своим номером строки
      t.value = f ? { formula: f.replace(new RegExp(`(\\$?[A-Z]{1,3})${last}(?!\\d)`, 'g'), `$1${n}`) } : null;
    });
    if (src.height) row.height = src.height;
    for (const [key, col] of Object.entries(info.cols)) {
      if (key === 'colorGroup') continue; // считает формула
      const v = typed(key, p[key]);
      if (v !== null) row.getCell(col).value = v;
    }
    row.commit(); added.push(n); last = n;
  }
  if (ws.autoFilter && typeof ws.autoFilter === 'string') ws.autoFilter = ws.autoFilter.replace(/\d+$/, String(last));
  await save(wb, file);
  // проверка: читаем заново
  const m = await load(file);
  for (const p of products) {
    const rec = m.byArticle.get(String(p.article).toLowerCase());
    if (!rec) throw new Error(`Проверка не прошла: артикул ${p.article} после записи не найден. Копия до изменения: ${copy}`);
    for (const key of Object.keys(info.cols)) {
      if (key === 'colorGroup' || p[key] === undefined || p[key] === '' || p[key] === null) continue;
      if (String(typed(key, p[key])) !== rec[key]) throw new Error(`Проверка не прошла: ${p.article}, поле «${info.labels[key]}». Копия до изменения: ${copy}`);
    }
  }
  return { rows: added, backup: copy };
}

/** Изменить поля существующих строк. changes: [{article, fields:{key:value}}] */
async function updateRows(file, changes, backupDir) {
  assertWritable(file);
  const copy = backup(file, backupDir);
  const { wb, ws, info } = await open(file);
  const rowOf = new Map();
  for (let r = info.headerRow + 1; r <= info.last; r++) rowOf.set(cellText(ws.getRow(r).getCell(info.cols.article).value).toLowerCase(), r);
  for (const ch of changes) {
    const r = rowOf.get(String(ch.article).toLowerCase());
    if (!r) throw new Error(`Артикул ${ch.article} в файле не найден`);
    for (const [key, value] of Object.entries(ch.fields)) {
      if (!info.cols[key] || key === 'colorGroup' || key === 'article') continue;
      ws.getRow(r).getCell(info.cols[key]).value = typed(key, value);
    }
  }
  await save(wb, file);
  const m = await load(file);
  for (const ch of changes) {
    const rec = m.byArticle.get(String(ch.article).toLowerCase());
    for (const [key, value] of Object.entries(ch.fields)) {
      if (!info.cols[key] || key === 'colorGroup' || key === 'article') continue;
      const want = typed(key, value);
      if ((want === null ? '' : String(want)) !== rec[key]) throw new Error(`Проверка не прошла: ${ch.article}, поле «${info.labels[key]}». Копия до изменения: ${copy}`);
    }
  }
  return { backup: copy };
}

module.exports = { load, addRows, updateRows, backup, modelFromGrid, typed, cellText, FIELDS: FIELDS.map((f) => f[0]), CLOSED, NUMERIC, norm };
