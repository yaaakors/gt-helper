// Папки каталога на сети: <корень>\<Бренд>\[<Виробник>\]<Колекція>\{Faces, Рендери, Живі фото та відео}
'use strict';
const fs = require('fs');
const path = require('path');

const SUBDIRS = ['Faces', 'Рендери', 'Живі фото та відео'];
const squash = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-zа-яіїєґ0-9]/gi, '');

function dirs(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return null; }
}
/** Верхние папки каталога, куда кладут коллекции: бренды, «2026», «_Ексклюзиви …». null — корень недоступен */
function brands(root) {
  if (!root) return null;
  const list = dirs(root);
  return list && list.filter((n) => !n.startsWith('.') && !n.startsWith('$') && (!n.startsWith('_') || /^_ексклюзив/i.test(n)));
}
/** Найти уже существующую папку коллекции: <верхняя>\<Колекція> или <верхняя>\<Виробник>\<Колекція> */
function findCollection(root, tops, collection) {
  const key = squash(collection);
  for (const top of tops) {
    const level1 = dirs(path.join(root, top)) || [];
    const hit = level1.find((n) => squash(n) === key);
    if (hit) return { parent: top, name: hit };
    for (const mid of level1) {
      if (SUBDIRS.includes(mid)) continue;
      const hit2 = (dirs(path.join(root, top, mid)) || []).find((n) => squash(n) === key);
      if (hit2) return { parent: path.join(top, mid), name: hit2 };
    }
  }
  return null;
}
/** Куда класть НОВУЮ коллекцию (правила Вита 11.11.2026): эксклюзив — в «_Ексклюзиви <сеть>», остальное — в папку текущего года */
function defaultParent(tops, product, year) {
  const status = String(product.status || '');
  let net = (/ексклюзив\s+(.+)/i.exec(status) || [])[1] || '';
  if (!net && /^deseo/i.test(product.tm || '')) net = 'Агромат';   // Deseo — эксклюзив Агромата
  if (net) {
    const ex = tops.find((n) => /^_ексклюзив/i.test(n) && n.toLowerCase().includes(net.toLowerCase()));
    if (ex) return { parent: ex, why: 'эксклюзив' };
  }
  const y = tops.find((n) => n === String(year));
  if (y) return { parent: y, why: 'новинки этого года' };
  return null;
}
/** Подобрать папку бренда по ТМ: сначала сохранённый выбор, потом совпадение названия */
function matchBrand(tm, list, saved) {
  if (saved && saved[tm] && list.includes(saved[tm])) return saved[tm];
  const key = squash(tm);
  return list.find((b) => squash(b) === key) || null;
}
function collectionPaths(root, brand, collection) {
  const base = path.join(root, brand, collection);
  return { base, subs: SUBDIRS.map((s) => path.join(base, s)) };
}
// ---------- быстрый указатель папок ----------
// Сетевая папка медленная, поэтому список папок коллекций читается один раз (не блокируя окно)
// и держится в памяти 10 минут. Недоступная сеть не «подвешивает» программу: ждём не дольше нескольких секунд.
const fsp = fs.promises;
const IMG = /\.(jpe?g|png|webp)$/i;
const withTimeout = (pr, ms) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
async function list(p, ms = 8000) { try { return await withTimeout(fsp.readdir(p, { withFileTypes: true }), ms); } catch { return null; } }
async function adirs(p, ms) { const l = await list(p, ms); return l && l.filter((d) => d.isDirectory()).map((d) => d.name); }
let idx = null; let building = null;
async function build(root) {
  const all = await adirs(root, 5000);
  if (!all) return null;
  const tops = all.filter((n) => !n.startsWith('.') && !n.startsWith('$') && (!n.startsWith('_') || /^_ексклюзив/i.test(n)));
  const map = new Map(); const level1 = [];
  const l1 = await Promise.all(tops.map((t) => adirs(path.join(root, t))));
  tops.forEach((t, i) => { for (const n of l1[i] || []) { const e = { parent: t, name: n, subs: null }; level1.push(e); if (!map.has(squash(n))) map.set(squash(n), e); } });
  // второй уровень (<верхняя>\<Виробник>\<Колекція>) — по 12 папок одновременно
  let next = 0;
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (next < level1.length) {
      const e = level1[next++]; const kids = await adirs(path.join(root, e.parent, e.name));
      e.subs = kids || [];
      if (kids && !kids.some((k) => SUBDIRS.includes(k))) for (const k of kids) if (!map.has(squash(k))) map.set(squash(k), { parent: path.join(e.parent, e.name), name: k, subs: null });
    }
  }));
  return { root, at: Date.now(), tops, map };
}
/** Указатель папок каталога. null — корень не задан или недоступен. fresh — перечитать сейчас. */
async function index(root, fresh) {
  if (!root) return null;
  if (!fresh && idx && idx.root === root) {
    if (Date.now() - idx.at > 10 * 60000 && !building) { building = build(root).then((r) => { if (r) idx = r; }).finally(() => { building = null; }); } // устарел — обновим в фоне
    return idx;
  }
  if (!building) building = build(root).then((r) => { idx = r; }).finally(() => { building = null; });
  await building;
  return idx && idx.root === root ? idx : null;
}
const reset = () => { idx = null; };
/** Папка коллекции по указателю: {parent, name, dir} или null */
function find(ix, collection) { const e = ix && ix.map.get(squash(collection)); return e ? Object.assign({ dir: path.join(ix.root, e.parent, e.name) }, e) : null; }
/** Картинки в папке (только сама папка, без вложенных) */
async function images(dir) { const l = await list(dir); return (l || []).filter((d) => d.isFile() && IMG.test(d.name)).map((d) => d.name).sort((a, b) => a.localeCompare(b, 'uk', { numeric: true })); }
/** Фото товара в корне папки коллекции: «Колекція колір формат - АРТИКУЛ.jpg» */
async function productPhotos(dir, article) {
  const all = await images(dir);
  if (!article) return all;
  const key = String(article).toLowerCase();
  return all.filter((n) => { const stem = n.replace(IMG, '').toLowerCase().trim(); return stem.endsWith(key) && !/[\p{L}\d]/u.test(stem.slice(-key.length - 1, -key.length)); });
}
/** Визуализации коллекции: папка «Рендери» (и вложенные на один уровень) */
async function renders(dir) {
  const base = path.join(dir, SUBDIRS[1]); const out = (await images(base)).map((n) => path.join(base, n));
  for (const sub of (await adirs(base)) || []) for (const n of await images(path.join(base, sub))) out.push(path.join(base, sub, n));
  const main = (f) => (/(^|[\s_])main([\s_.]|$)/i.test(path.basename(f)) ? 0 : 1); // общий план («main») — первым
  return out.sort((a, b) => main(a) - main(b));
}

/** Каких стандартных подпапок не хватает в существующей папке коллекции */
function missingSubs(root, parent, collection) {
  const have = (dirs(path.join(root, parent, collection)) || []).map((n) => n.toLowerCase());
  return SUBDIRS.filter((x) => !have.includes(x.toLowerCase()));
}
/** Создать папку коллекции и стандартные подпапки. Возвращает, что создано и что уже было. */
function ensureCollection(root, brand, collection) {
  const { base, subs } = collectionPaths(root, brand, collection);
  if (!fs.existsSync(path.join(root, brand))) throw new Error('Нет папки: ' + path.join(root, brand));
  const created = []; const existed = [];
  for (const p of [base, ...subs]) {
    if (fs.existsSync(p)) { existed.push(p); continue; }
    fs.mkdirSync(p, { recursive: true });
    if (!fs.existsSync(p)) throw new Error('Папка не создалась: ' + p);
    created.push(p);
  }
  return { base, created, existed };
}
module.exports = { index, reset, find, images, productPhotos, renders, brands, matchBrand, findCollection, missingSubs, defaultParent, collectionPaths, ensureCollection, SUBDIRS };
