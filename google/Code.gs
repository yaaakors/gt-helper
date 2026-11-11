/**
 * GT Помощник — связь программы с этой Google Таблицей.
 * Вставляется в таблицу: Расширения → Apps Script. Разворачивается как веб-приложение.
 * Программа присылает запросы с ключом; без ключа скрипт ничего не делает.
 */
const TOKEN = '__TOKEN__';
const VERSION = 1;

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (!req.token || req.token !== TOKEN) throw new Error('Неверный ключ. Скопируйте скрипт из программы заново.');
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { out = handle(req); } finally { lock.releaseLock(); }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('GT Помощник: скрипт установлен, версия ' + VERSION);
}

function handle(req) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheets()[0];
  if (req.action === 'read') {
    const cs = ss.getSheetByName('Кольори');
    return { ok: true, version: VERSION, name: ss.getName(), sheet: sh.getName(), values: sh.getDataRange().getValues(), colors: cs ? cs.getDataRange().getValues() : [] };
  }
  if (req.action === 'append') return append(sh, req);
  if (req.action === 'update') return update(sh, req);
  throw new Error('Скрипт в таблице не знает команду «' + req.action + '». Обновите скрипт: скопируйте его из программы заново.');
}

function articleRows(sh, req) {
  const map = {};
  const lastRow = sh.getLastRow();
  let last = req.headerRow;
  if (lastRow > req.headerRow) {
    const vals = sh.getRange(req.headerRow + 1, req.articleCol, lastRow - req.headerRow, 1).getValues();
    for (let i = 0; i < vals.length; i++) {
      const a = String(vals[i][0]).trim();
      if (a) { map[a.toLowerCase()] = req.headerRow + 1 + i; last = req.headerRow + 1 + i; }
    }
  }
  return { map: map, last: last };
}

function put(cell, value) {
  if (value === null || value === '') { cell.clearContent(); return; }
  // цифры, пришедшие текстом (артикул 46001, штрихкод), должны остаться текстом
  if (typeof value === 'string' && /^[\d.,\/]+$/.test(value)) cell.setNumberFormat('@');
  cell.setValue(value);
}

function append(sh, req) {
  const info = articleRows(sh, req);
  req.rows.forEach(function (r) {
    const a = String(r[req.articleCol] || '').trim().toLowerCase();
    if (!a) throw new Error('В строке нет артикула');
    if (info.map[a]) throw new Error('Артикул ' + r[req.articleCol] + ' уже есть в таблице');
  });
  if (info.last <= req.headerRow) throw new Error('В таблице нет ни одной строки с данными — не с чего взять оформление');
  const lastCol = sh.getLastColumn();
  let last = info.last;
  const added = [];
  req.rows.forEach(function (r) {
    const n = last + 1;
    if (n > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
    const src = sh.getRange(last, 1, 1, lastCol);
    const dst = sh.getRange(n, 1, 1, lastCol);
    dst.clearContent();
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    const formulas = src.getFormulasR1C1()[0];
    for (let c = 0; c < formulas.length; c++) if (formulas[c]) sh.getRange(n, c + 1).setFormulaR1C1(formulas[c]);
    Object.keys(r).forEach(function (col) { put(sh.getRange(n, Number(col)), r[col]); });
    added.push(n);
    last = n;
  });
  growFilter(sh, last);
  SpreadsheetApp.flush();
  return { ok: true, rows: added };
}

function update(sh, req) {
  const info = articleRows(sh, req);
  req.changes.forEach(function (ch) { if (!info.map[String(ch.article).toLowerCase()]) throw new Error('Артикул ' + ch.article + ' в таблице не найден'); });
  req.changes.forEach(function (ch) {
    const row = info.map[String(ch.article).toLowerCase()];
    Object.keys(ch.cells).forEach(function (col) { put(sh.getRange(row, Number(col)), ch.cells[col]); });
  });
  SpreadsheetApp.flush();
  return { ok: true };
}

// Если на листе включён фильтр — растянуть его на новые строки, условия сохранить
function growFilter(sh, last) {
  try {
    const f = sh.getFilter();
    if (!f) return;
    const r = f.getRange();
    if (r.getLastRow() >= last) return;
    const crit = [];
    for (let c = r.getColumn(); c <= r.getLastColumn(); c++) crit.push([c, f.getColumnFilterCriteria(c)]);
    f.remove();
    const nf = sh.getRange(r.getRow(), r.getColumn(), last - r.getRow() + 1, r.getNumColumns()).createFilter();
    crit.forEach(function (x) { if (x[1]) nf.setColumnFilterCriteria(x[0], x[1]); });
  } catch (err) { /* фильтр не обязателен */ }
}
