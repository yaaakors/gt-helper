// Google Таблица как источник характеристик. Программа общается со скриптом внутри таблицы
// (google/Code.gs, развёрнут как веб-приложение) — отдельный доступ к аккаунту Google не нужен.
'use strict';
const fs = require('fs');
const path = require('path');
const { modelFromGrid, typed } = require('./sheet');

const SCRIPT_VERSION = 1;

async function call(cfg, payload) {
  if (!cfg.url) throw new Error('Не указан адрес веб-приложения Google Таблицы (Настройки)');
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(cfg.url)) throw new Error('Адрес должен начинаться с https://script.google.com/ — это «URL веб-приложения» из окна развёртывания');
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 60000);
  let res; let text;
  try {
    res = await fetch(cfg.url, { method: 'POST', redirect: 'follow', signal: ctrl.signal, headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ token: cfg.token }, payload)) });
    text = await res.text();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Google Таблица не ответила за минуту' : 'Нет связи с Google Таблицей (проверьте интернет): ' + (e.message || e));
  } finally { clearTimeout(timer); }
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(/accounts\.google\.com|Sign in|Вход/i.test(text) ? 'Google просит войти в аккаунт: при развёртывании нужно выбрать «У кого есть доступ: Все»' : `Google Таблица ответила непонятно (код ${res.status}). Проверьте адрес веб-приложения`);
  }
  if (!data.ok) throw new Error(data.error || 'Google Таблица вернула ошибку');
  return data;
}

let cache = null;
/** Прочитать таблицу. Повторные чтения в течение 20 секунд берутся из памяти. */
async function load(cfg, fresh) {
  if (!fresh && cache && cache.url === cfg.url && cache.token === cfg.token && Date.now() - cache.at < 20000) return cache.model;
  const d = await call(cfg, { action: 'read' });
  const model = modelFromGrid(d.values, d.colors, { sheetName: d.sheet, title: 'Google Таблица', docName: d.name, scriptVersion: d.version, grid: d.values });
  cache = { url: cfg.url, token: cfg.token, at: Date.now(), model };
  return model;
}

/** Снимок значений перед изменением — в папку копий (плюс у самой таблицы есть «История версий») */
async function snapshot(model, backupDir) {
  const ExcelJS = require('exceljs');
  fs.mkdirSync(backupDir, { recursive: true });
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  const to = path.join(backupDir, `GoogleТаблица_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.xlsx`);
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(String(model.sheetName || 'Лист').slice(0, 31));
  for (const row of model.grid) ws.addRow(row.map((v) => (v === '' ? null : v)));
  await wb.xlsx.writeFile(to);
  const all = fs.readdirSync(backupDir).filter((f) => f.startsWith('GoogleТаблица_')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 40))) { try { fs.unlinkSync(path.join(backupDir, old)); } catch { /* не страшно */ } }
  return to;
}

function cells(model, fields, forUpdate) {
  const out = {};
  for (const [key, col] of Object.entries(model.cols)) {
    if (key === 'colorGroup' || !(key in fields)) continue;
    if (forUpdate && key === 'article') continue;
    const v = typed(key, fields[key]);
    if (v !== null) out[col] = v; else if (forUpdate) out[col] = null;
  }
  return out;
}
function verify(model, article, fields, copy) {
  const rec = model.byArticle.get(String(article).toLowerCase());
  if (!rec) throw new Error(`Проверка не прошла: артикул ${article} после записи не найден. Снимок до изменения: ${copy}`);
  for (const key of Object.keys(model.cols)) {
    if (key === 'colorGroup' || key === 'article' || !(key in fields)) continue;
    const want = typed(key, fields[key]);
    if ((want === null ? '' : String(want)) !== rec[key]) throw new Error(`Проверка не прошла: ${article}, поле «${model.labels[key]}» (в таблице «${rec[key]}»). Снимок до изменения: ${copy}`);
  }
}

async function addRows(cfg, products, backupDir) {
  const before = await load(cfg, true);
  for (const p of products) if (before.byArticle.has(String(p.article).toLowerCase())) throw new Error(`Артикул ${p.article} уже есть в таблице`);
  const copy = await snapshot(before, backupDir);
  const r = await call(cfg, { action: 'append', headerRow: before.headerRow, articleCol: before.cols.article, rows: products.map((p) => cells(before, p, false)) });
  const after = await load(cfg, true);
  for (const p of products) verify(after, p.article, p, copy);
  return { rows: r.rows, backup: copy };
}

async function updateRows(cfg, changes, backupDir) {
  const before = await load(cfg, true);
  const copy = await snapshot(before, backupDir);
  await call(cfg, { action: 'update', headerRow: before.headerRow, articleCol: before.cols.article, changes: changes.map((ch) => ({ article: ch.article, cells: cells(before, ch.fields, true) })) });
  const after = await load(cfg, true);
  for (const ch of changes) verify(after, ch.article, ch.fields, copy);
  return { backup: copy };
}

/** Текст скрипта для вставки в таблицу (с ключом этой программы) */
function script(token, template) { return template.replace('__TOKEN__', token); }

module.exports = { load, addRows, updateRows, script, SCRIPT_VERSION };
