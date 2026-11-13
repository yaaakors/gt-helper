// Названия коллекций «на слух»: «калаката экстра», «калакатта екстра» → Calacatta Extra.
// Плюс перепутанная раскладка: «лфыыуд» → Kassel.
'use strict';

const CYR = { а: 'a', б: 'b', в: 'v', г: 'g', ґ: 'g', д: 'd', е: 'e', є: 'e', ё: 'o', ж: 'zh', з: 'z', и: 'i', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ы: 'i', э: 'e', ю: 'u', я: 'a', ь: '', ъ: '', '’': '', "'": '' };
const LAYOUT = { й: 'q', ц: 'w', у: 'e', к: 'r', е: 't', н: 'y', г: 'u', ш: 'i', щ: 'o', з: 'p', ф: 'a', ы: 's', і: 's', в: 'd', а: 'f', п: 'g', р: 'h', о: 'j', л: 'k', д: 'l', я: 'z', ч: 'x', с: 'c', м: 'v', и: 'b', т: 'n', ь: 'm' };
const STOP = new Set(['добавь', 'добавить', 'покажи', 'показать', 'создай', 'создать', 'коллекция', 'коллекцию', 'коллекции', 'колекція', 'плитка', 'плитку', 'плитки', 'фейсы', 'фейс', 'лица', 'рендеры', 'визуализации', 'папка', 'папку', 'папки', 'артикул', 'артикула', 'картинку', 'картинки', 'фото', 'есть', 'для', 'что', 'это', 'или', 'новый', 'новая', 'новую', 'формат', 'цвет', 'задача']);

/** Ключ «на слух»: латиница и кириллица приводятся к одному виду */
function phon(s) {
  let t = String(s || '').toLowerCase();
  t = t.replace(/дж/g, 'j').replace(/кс/g, 'x');
  t = [...t].map((c) => (c in CYR ? CYR[c] : c)).join('');
  t = t.replace(/fj/g, 'fi').replace(/tz/g, 's').replace(/sch/g, 'sh').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/qu/g, 'kv').replace(/q/g, 'k').replace(/x/g, 'ks').replace(/w/g, 'v').replace(/y/g, 'i')
    .replace(/c(?=[ei])/g, 's').replace(/c/g, 'k').replace(/ts/g, 's').replace(/th/g, 't').replace(/j/g, 'dzh').replace(/[^a-z0-9]/g, '');
  return t.replace(/(.)\1+/g, '$1');
}
function dist(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const swap = (s) => [...String(s).toLowerCase()].map((c) => LAYOUT[c] || c).join('');
const hasCyr = (s) => /[а-яёіїєґ]/i.test(s);

/** Насколько строка похожа на название: 0 — точно, 1–2 — почти, null — нет */
function score(text, name) {
  const a = phon(text); const b = phon(name);
  if (a.length < 4 || b.length < 4) return swap(text).replace(/\s+/g, ' ') === name.toLowerCase() ? 0 : null;
  if (a === b) return 0;
  if (swap(text).replace(/\s+/g, ' ') === name.toLowerCase()) return 0;
  const d = dist(a, b); const allow = b.length >= 11 ? 2 : b.length >= 6 ? 1 : 0;
  return d <= allow ? d : null;
}

/** Целая строка — это название одной из коллекций? (names — список названий) */
function resolve(text, names) {
  let best = null;
  for (const n of names) { const s = score(text, n); if (s !== null && (!best || s < best.s || (s === best.s && n.length > best.name.length))) best = { name: n, s }; }
  return best ? best.name : null;
}

/** Найти название коллекции внутри фразы, написанной кириллицей */
function find(text, names) {
  const words = String(text || '').split(/[^\p{L}\d'’]+/u).filter(Boolean);
  let best = null;
  for (const n of names) {
    const k = n.split(/\s+/).length;
    for (let i = 0; i + k <= words.length; i++) {
      const win = words.slice(i, i + k);
      if (!win.some(hasCyr) || win.every((w) => STOP.has(w.toLowerCase()))) continue;
      if (k === 1 && STOP.has(win[0].toLowerCase())) continue;
      const s = score(win.join(' '), n);
      if (s === null) continue;
      if (!best || s < best.s || (s === best.s && n.length > best.name.length)) best = { name: n, s };
    }
  }
  return best ? best.name : null;
}

module.exports = { phon, resolve, find };
