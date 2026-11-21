// История выпусков: каждый файл выпуска, который попал в чат, записывается сюда — дата, коды, сколько.
// Отсюда видно, когда артикул выпускался в последний раз и как часто.
'use strict';
const fs = require('fs');

class Releases {
  constructor(store) { this.file = store.file('releases.jsonl'); this.cache = null; }
  all() {
    if (this.cache) return this.cache;
    let list = [];
    try { list = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* ещё нет истории */ }
    return (this.cache = list);
  }
  /** Записать выпуск одного дня. Тот же день и код второй раз не пишется. Возвращает, сколько строк добавилось */
  add(date, fileName, rows) {
    const d = `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day || 1).padStart(2, '0')}`;
    const seen = new Set(this.all().filter((x) => x.date === d).map((x) => x.code));
    const fresh = rows.filter((r) => r.total > 0 && !seen.has(r.code)).map((r) => ({ date: d, code: r.code, article: r.article, first: r.first, collection: r.collection, qty: r.qty, total: r.total, file: fileName }));
    if (fresh.length) { fs.appendFileSync(this.file, fresh.map((x) => JSON.stringify(x) + '\n').join(''), 'utf8'); this.cache = null; }
    return { added: fresh.length, first: fresh.filter((x) => x.first).length, date: d, dup: rows.filter((r) => r.total > 0).length - fresh.length };
  }
  /** Выпуски артикула (первый сорт), новые сверху */
  of(article) { const k = String(article).toLowerCase(); return this.all().filter((x) => x.first && String(x.article).toLowerCase() === k).sort((a, b) => b.date.localeCompare(a.date)); }
  last(article) { const l = this.of(article); return l.length ? l[0].date : ''; }
  /** Дата → «12.11.2026» */
  static dmy(d) { const [y, m, dd] = String(d).split('-'); return `${dd}.${m}.${y}`; }
}

module.exports = { Releases };
