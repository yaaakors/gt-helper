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
module.exports = { brands, matchBrand, findCollection, defaultParent, collectionPaths, ensureCollection, SUBDIRS };
