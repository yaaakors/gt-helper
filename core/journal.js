// Журнал «запросы разработчику»: всё, что программа не поняла или не смогла сделать.
// Одна запись = одна строка JSON в файле dev-requests.jsonl (в папке данных).
'use strict';
const fs = require('fs');

const KINDS = {
  not_understood: 'Не понял команду',
  failed: 'Не смог выполнить',
  error: 'Ошибка программы',
  feedback: 'Замечание',
  idea: 'Пожелание',
};

class Journal {
  constructor(store, version) { this.store = store; this.version = version; }
  get file() { return this.store.file('dev-requests.jsonl'); }
  add(kind, message, details) {
    const rec = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      time: new Date().toISOString(), version: this.version,
      kind, message: String(message || '').slice(0, 2000),
      details: details === undefined ? null : details,
    };
    try { fs.appendFileSync(this.file, JSON.stringify(rec) + '\n', 'utf8'); } catch { /* журнал не должен ронять программу */ }
    return rec;
  }
  /** Убрать из журнала записи, которые разработчик уже обработал (список приходит с обновлением программы) */
  prune() {
    let done = [];
    try { done = require('./journal-done.json').done || []; } catch { return 0; }
    if (!done.length) return 0;
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return 0; }
    const ids = new Set(done); const lines = text.split('\n').filter(Boolean);
    const keep = lines.filter((l) => { try { return !ids.has(JSON.parse(l).id); } catch { return true; } });
    if (keep.length === lines.length) return 0;
    try { fs.writeFileSync(this.file, keep.map((l) => l + '\n').join(''), 'utf8'); } catch { return 0; }
    return lines.length - keep.length;
  }
  list() {
    let text = '';
    try { text = fs.readFileSync(this.file, 'utf8'); } catch { return []; }
    return text.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean).reverse().map((r) => Object.assign(r, { kindLabel: KINDS[r.kind] || r.kind }));
  }
}
module.exports = { Journal, KINDS };
