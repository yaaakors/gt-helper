// Планировщик: задачи без дат. Теги — через решётку в тексте (#каталог).
'use strict';
const TAG_RE = /#([\p{L}\p{N}_-]+)/gu;

function tagsOf(text) { return [...new Set([...text.matchAll(TAG_RE)].map((m) => m[1].toLowerCase()))]; }

class Tasks {
  constructor(store) { this.store = store; }
  _load() { return this.store.read('tasks.json', { tasks: [] }); }
  _save(d) { this.store.write('tasks.json', d); }
  list() { return this._load().tasks; }
  add(text) {
    text = String(text || '').trim();
    if (!text) return null;
    const d = this._load();
    const t = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text, tags: tagsOf(text), created: new Date().toISOString(), done: null };
    d.tasks.unshift(t); this._save(d);
    return t;
  }
  toggle(id) {
    const d = this._load(); const t = d.tasks.find((x) => x.id === id);
    if (!t) return null;
    t.done = t.done ? null : new Date().toISOString();
    this._save(d); return t;
  }
  edit(id, text) {
    text = String(text || '').trim();
    const d = this._load(); const t = d.tasks.find((x) => x.id === id);
    if (!t || !text) return null;
    t.text = text; t.tags = tagsOf(text); this._save(d); return t;
  }
  remove(id) { const d = this._load(); d.tasks = d.tasks.filter((x) => x.id !== id); this._save(d); return true; }

  /** Выполненные за период (даты ГГГГ-ММ-ДД включительно, по местному времени) с тегом */
  report({ from, to, tag } = {}) {
    const day = (iso) => { const x = new Date(iso); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    return this.list().filter((t) => t.done)
      .filter((t) => (!from || day(t.done) >= from) && (!to || day(t.done) <= to) && (!tag || t.tags.includes(tag)))
      .sort((a, b) => (a.done < b.done ? 1 : -1))
      .map((t) => Object.assign({ doneDay: day(t.done) }, t));
  }
  async exportXlsx(file, filter) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Отчёт');
    ws.columns = [{ header: 'Выполнено', width: 14 }, { header: 'Задача', width: 80 }, { header: 'Теги', width: 28 }];
    ws.getRow(1).font = { bold: true };
    for (const t of this.report(filter)) ws.addRow([t.doneDay.split('-').reverse().join('.'), t.text, t.tags.join(', ')]);
    await wb.xlsx.writeFile(file);
    return file;
  }
}
module.exports = { Tasks, tagsOf };
