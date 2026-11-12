// Файлы, брошенные в чат: чтение Excel (в том числе старого .xls), распознавание вида файла,
// проверка выпуска на новые артикулы, сверка упаковочных данных.
'use strict';
const path = require('path');

const EXCEL = ['.xls', '.xlsx', '.xlsm', '.csv'];
const IMAGE = ['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp'];
const kindOf = (file) => { const e = path.extname(file).toLowerCase(); return EXCEL.includes(e) ? 'excel' : IMAGE.includes(e) ? 'image' : 'other'; };
const low = (v) => String(v === null || v === undefined ? '' : v).toLowerCase().replace(/\s+/g, ' ').trim();
const num = (v) => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const round = (v, n) => Math.round(v * 10 ** n) / 10 ** n;

/** Первый непустой лист файла — сеткой значений */
function readGrid(file) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(file, { cellDates: false });
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true });
    if (grid.some((r) => r.some((c) => c !== ''))) return { sheet: name, grid };
  }
  return { sheet: wb.SheetNames[0] || '', grid: [] };
}

/** Что это за таблица: упаковка, выпуск или незнакомая */
function detect(grid) {
  const head = (grid[0] || []).map(low);
  if (head.some((h) => h.startsWith('код кол')) && head.some((h) => h.startsWith('штрих'))) return 'pack';
  // выпуск: во второй колонке коды из 6 знаков, в третьей — длинное название
  const codes = grid.slice(1).filter((r) => /^[\p{L}\d]{6}$/u.test(String(r[1] || '').trim()) && String(r[2] || '').length > 15);
  if (codes.length && codes.length >= (grid.length - 1) * 0.6) return 'release';
  if (grid.slice(0, 6).some((r) => low(r[0]) === 'артикул')) return 'sheet';
  return 'unknown';
}

/** Артикул характеристик из заводского кода: «L71580» → «L7158» (последний знак — сорт) */
function baseArticle(code, model) { const c = String(code).trim(); return c.length === model.articleLen + 1 ? c.slice(0, model.articleLen) : c; }
const firstGrade = (code) => /[01]$/.test(String(code).trim()); // в работу — только коды на 0 или 1

/** Выпуск: какие артикулы первого сорта ещё не заведены в характеристиках */
function releaseCheck(grid, model) {
  let collection = ''; let checked = 0; const fresh = new Map();
  for (const r of grid.slice(1)) {
    if (String(r[0] || '').trim()) collection = String(r[0]).trim();
    const code = String(r[1] || '').trim();
    if (!code || !firstGrade(code)) continue;
    checked++;
    const art = baseArticle(code, model);
    if (!model.byArticle.has(art.toLowerCase()) && !fresh.has(art.toLowerCase())) fresh.set(art.toLowerCase(), { article: art, code, collection, name: String(r[2] || '').trim() });
  }
  return { checked, fresh: [...fresh.values()] };
}

const PACK_COLS = { code: 'код кол', ean: 'штрих', w1: 'вага 1м2', m2pal: 'м2 на палеті', m2pack: 'ємність пачки', packsPal: 'пачок на палеті', wpal: 'вага пакет-піддону при відвантаженні авто' };
/** Упаковка: чем файл отличается от характеристик. Возвращает правки по артикулам. */
function packDiff(grid, model) {
  const head = (grid[0] || []).map(low); const col = {};
  for (const [k, start] of Object.entries(PACK_COLS)) { col[k] = head.findIndex((h) => h.startsWith(start)); if (col[k] < 0) throw new Error(`В файле упаковки нет колонки «${start}…»`); }
  const changes = []; const seen = new Set(); let matched = 0; let unknown = 0;
  for (const r of grid.slice(1)) {
    const code = String(r[col.code] || '').trim();
    if (!code || !firstGrade(code)) continue;
    const rec = model.byArticle.get(baseArticle(code, model).toLowerCase());
    if (!rec) { unknown++; continue; }
    if (seen.has(rec.article)) continue; // у артикула бывают коды и на 0, и на 1 — берём первый
    seen.add(rec.article); matched++;
    const m2 = num(r[col.m2pack]); const w1 = num(r[col.w1]); const want = {};
    const ean = String(r[col.ean] || '').trim(); if (/^\d{8,14}$/.test(ean)) want.ean = ean;
    if (m2) want.m2pack = m2;
    if (w1) want.w1 = w1;
    if (m2 && w1) want.wpack = round(m2 * w1, 2);
    if (num(r[col.packsPal])) want.packsPal = num(r[col.packsPal]);
    if (num(r[col.m2pal])) want.m2pal = num(r[col.m2pal]);
    if (num(r[col.wpal])) want.wpal = round(num(r[col.wpal]), 1);
    const fm = /(\d+)\D+(\d+)/.exec(rec.format || '');           // штук в упаковке = площадь упаковки / площадь плитки
    if (m2 && fm) { const pcs = m2 / (fm[1] * fm[2] / 1e6); if (Math.abs(pcs - Math.round(pcs)) < 0.15) want.pcs = Math.round(pcs); }
    const fields = {};
    for (const [k, v] of Object.entries(want)) {
      if (!model.cols[k]) continue;
      const have = rec[k];
      const same = k === 'ean' ? have === v : (have !== '' && num(have) !== null && Math.abs(num(have) - v) < 0.011);
      if (!same) fields[k] = String(v);
    }
    if (Object.keys(fields).length) changes.push({ article: rec.article, collection: rec.collection, fields });
  }
  return { matched, unknown, changes };
}

module.exports = { kindOf, readGrid, detect, releaseCheck, packDiff, baseArticle, firstGrade };
