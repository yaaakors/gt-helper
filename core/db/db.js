// База данных характеристик (SQLite). Сейчас — файл в папке данных; позже тот же код работает на сервере.
// Для остальной программы база выглядит как таблица «одна строка = один артикул» (как Google Таблица),
// поэтому чат, проверки и выгрузка работают без изменений.
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { modelFromGrid, typed } = require('../tiles/sheet');

// Колонки в порядке файла характеристик v7 (для модели и выгрузки)
const COLUMNS = [
  ['Ідентифікація', [['article', 'Артикул'], ['tm', 'ТМ'], ['collection', 'Колекція'], ['decor', 'Назва декору']]],
  ['Класифікація', [['purpose', 'Призначення'], ['usage', 'Застосування'], ['type', 'Тип']]],
  ['Геометрія', [['format', 'Формат'], ['thickness', 'Товщина, мм'], ['rect', 'Ректифікат']]],
  ['Зовнішній вигляд', [['colorGroup', 'Група кольору'], ['color', 'Колір'], ['surface', 'Поверхня'], ['relief', 'Рельєф'], ['frost', 'Морозостійкість'], ['design', 'Тип дизайну']]],
  ['Технічні характеристики', [['pei', 'Зносостійкість (PEI)'], ['ptv', 'Коефіцієнт тертя ковзання (PTV)'], ['r', 'Коефіцієнт тертя ковзання (R)']]],
  ['Упаковка і штрихкод', [['ean', 'Штрихкод EAN'], ['pcs', 'Шт в упаковці'], ['m2pack', 'м² в упаковці'], ['w1', 'Вага 1 м², кг'], ['wpack', 'Вага упаковки, кг'], ['packsPal', 'Упаковок на палеті'], ['m2pal', 'м² на палеті'], ['wpal', 'Вага палети, кг'], ['packNote', 'Упаковка: примітка']]],
  ['Статус', [['status', 'Актуальність'], ['year', 'Рік випуску SKU'], ['month', 'Місяць випуску']]],
  ['Службові', [['comment', 'Коментар']]],
];
const FLAT = COLUMNS.flatMap(([, cols]) => cols);
// поле модели → колонка таблицы articles (простые поля)
const DIRECT = { decor: 'decor', purpose: 'purpose', type: 'type', format: 'format', thickness: 'thickness', rect: 'rect', frost: 'frost', color: 'color', surface: 'surface', relief: 'relief', pei: 'pei', ptv: 'ptv', r: 'r', year: 'year', month: 'month', comment: 'comment', ean: 'ean', pcs: 'pcs', m2pack: 'm2pack', w1: 'w1', wpack: 'wpack', packsPal: 'packs_pal', m2pal: 'm2pal', wpal: 'wpal', packNote: 'pack_note' };
const MULTI = ['usage', 'design'];
const now = () => new Date().toISOString();
const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** «Goldentile (GT Basic)» → бренд Goldentile, группа GT Basic. «SlimStyle» — это Golden Tile (решение Вита 12.11). */
function splitTm(tm) {
  const t = clean(tm); const m = /^(.*?)\s*\((.+)\)\s*$/.exec(t);
  let brand = m ? m[1].trim() : t; let group = m ? m[2].trim() : '';
  if (/^slim\s*style$/i.test(brand)) { group = group || 'SlimStyle'; brand = 'Goldentile'; }
  return { brand, group };
}
/** «Ексклюзив Епіцентр» → активный + сеть; «Виведений 2025» → выведен в 2025 */
function splitStatus(st) {
  const t = clean(st); let m;
  if ((m = /^ексклюзив\s+(.+)$/i.exec(t))) return { status: 'active', network: m[1].trim(), year: null };
  if ((m = /^виведен\p{L}*\s*(\d{4})?/iu.exec(t))) return { status: 'withdrawn', network: '', year: m[1] ? Number(m[1]) : null };
  return { status: 'active', network: '', year: null };
}
function joinStatus(a) {
  if (a.status === 'withdrawn') return 'Виведений' + (a.withdrawn_year ? ' ' + a.withdrawn_year : '');
  if (a.network) return 'Ексклюзив ' + a.network;
  return 'Активний Асортимент';
}
const num = (v) => { const t = clean(v).replace(',', '.'); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const fmtNum = (v) => (v === null || v === undefined ? '' : String(v));

class Db {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
    // базы, созданные до 0.4.5: добавляем месяц выпуска
    if (!this.db.prepare('PRAGMA table_info(articles)').all().some((c) => c.name === 'month')) this.db.exec('ALTER TABLE articles ADD COLUMN month INTEGER');
    if (!this.meta('version')) this.setMeta('version', '1');
    this.cache = null;
  }
  close() { try { this.db.close(); } catch { /* уже закрыта */ } }
  meta(k) { const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(k); return r ? r.value : null; }
  setMeta(k, v) { this.db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(v)); }
  count() { return this.db.prepare('SELECT COUNT(*) n FROM articles').get().n; }
  tx(fn) { this.db.exec('BEGIN'); try { const r = fn(); this.db.exec('COMMIT'); this.cache = null; return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }

  // ---------- справочные записи: найти или создать ----------
  ref(table, name) {
    const n = clean(name); if (!n) return null;
    const r = this.db.prepare(`SELECT id FROM ${table} WHERE name = ? COLLATE NOCASE`).get(n);
    return r ? r.id : Number(this.db.prepare(`INSERT INTO ${table}(name) VALUES(?)`).run(n).lastInsertRowid);
  }
  kindId() { return this.ref('kinds', 'плитка'); }
  collectionId(name, brandName) {
    const n = clean(name);
    const r = this.db.prepare('SELECT id, brand_id FROM collections WHERE name = ? COLLATE NOCASE').get(n);
    const brand = brandName ? this.ref('brands', brandName) : null;
    if (r) { if (!r.brand_id && brand) this.db.prepare('UPDATE collections SET brand_id = ? WHERE id = ?').run(brand, r.id); return r.id; }
    return Number(this.db.prepare('INSERT INTO collections(name, brand_id, kind_id) VALUES(?, ?, ?)').run(n, brand, this.kindId()).lastInsertRowid);
  }
  dictValue(field, value, parent) {
    const v = clean(value); if (!v) return null;
    const r = this.db.prepare('SELECT id FROM dict WHERE field = ? AND value = ?').get(field, v);
    if (r) { if (parent) this.db.prepare('UPDATE dict SET parent_id = ? WHERE id = ? AND parent_id IS NULL').run(parent, r.id); return r.id; }
    const sort = this.db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 s FROM dict WHERE field = ?').get(field).s;
    return Number(this.db.prepare('INSERT INTO dict(field, value, parent_id, sort) VALUES(?, ?, ?, ?)').run(field, v, parent || null, sort).lastInsertRowid);
  }
  log(user, source, entity, record, field, oldV, newV) {
    this.db.prepare('INSERT INTO history(time, user, source, entity, record, field, old, new) VALUES(?, ?, ?, ?, ?, ?, ?, ?)').run(now(), user, source || '', entity, String(record), field || null, oldV === undefined ? null : clean(oldV), newV === undefined ? null : clean(newV));
  }

  // ---------- запись артикула ----------
  /** Значения из модели (как строка таблицы) → поля артикула */
  toFields(p, current) {
    const f = {};
    for (const [k, col] of Object.entries(DIRECT)) if (k in p) f[col] = typed(k, p[k]);
    if ('format' in p) { const m = /(\d+)\D+(\d+)/.exec(clean(p.format)); f.format_w = m ? Number(m[1]) : null; f.format_h = m ? Number(m[2]) : null; }
    if ('thickness' in p) f.thickness = num(p.thickness);
    if ('pei' in p) f.pei = num(p.pei);
    if ('status' in p) {
      const s = splitStatus(p.status); f.status = s.status; f.withdrawn_year = s.year;
      f.network_id = s.network ? this.ref('networks', s.network) : null;
    }
    return f;
  }
  writeArticle(p, user, source) {
    const ex = this.db.prepare('SELECT * FROM articles WHERE code = ? COLLATE NOCASE').get(clean(p.article));
    const tm = 'tm' in p ? splitTm(p.tm) : null;
    const f = this.toFields(p, ex);
    if ('collection' in p || !ex) f.collection_id = this.collectionId(p.collection || (ex && this.collectionName(ex.collection_id)), tm && tm.brand);
    if (tm && tm.brand) f.brand_id = this.ref('brands', tm.brand);
    if (!ex && !f.collection_id) throw new Error(`У артикула ${p.article} нет коллекции`);
    let id;
    if (!ex) {
      const cols = Object.keys(f);
      id = Number(this.db.prepare(`INSERT INTO articles(code, kind_id, created, updated${cols.map((c) => ', ' + c).join('')}) VALUES(?, ?, ?, ?${cols.map(() => ', ?').join('')})`)
        .run(clean(p.article), this.kindId(), now(), now(), ...cols.map((c) => (f[c] === undefined ? null : f[c]))).lastInsertRowid);
      this.log(user, source, 'article', p.article, null, undefined, 'создан');
    } else {
      id = ex.id;
      const before = this.rowOf(id);
      const cols = Object.keys(f).filter((c) => (f[c] === undefined ? null : f[c]) !== ex[c]);
      if (cols.length) this.db.prepare(`UPDATE articles SET updated = ?${cols.map((c) => ', ' + c + ' = ?').join('')} WHERE id = ?`).run(now(), ...cols.map((c) => (f[c] === undefined ? null : f[c])), id);
      this._multi(id, p); this._groups(id, tm);
      const after = this.rowOf(id);
      for (const [k] of FLAT) if (k !== 'colorGroup' && clean(before[k]) !== clean(after[k])) this.log(user, source, 'article', ex.code, k, before[k], after[k]);
      return id;
    }
    this._multi(id, p); this._groups(id, tm);
    return id;
  }
  _multi(id, p) {
    for (const field of MULTI) {
      if (!(field in p)) continue;
      this.db.prepare('DELETE FROM article_values WHERE article_id = ? AND field = ?').run(id, field);
      clean(p[field]).split(',').map((x) => x.trim()).filter(Boolean).forEach((v, i) => {
        this.db.prepare('INSERT INTO article_values(article_id, field, value, pos) VALUES(?, ?, ?, ?)').run(id, field, v, i);
        this.dictValue(field, v);
      });
    }
    for (const field of ['purpose', 'type', 'surface', 'relief', 'r']) if (field in p && clean(p[field])) this.dictValue(field, p[field]);
    if ('color' in p && clean(p.color)) this.dictValue('color', p.color);
  }
  _groups(id, tm) {
    if (!tm) return;
    this.db.prepare('DELETE FROM article_groups WHERE article_id = ?').run(id);
    if (tm.group) this.db.prepare('INSERT INTO article_groups(article_id, group_id) VALUES(?, ?)').run(id, this.ref('groups', tm.group));
  }
  collectionName(id) { const r = this.db.prepare('SELECT name FROM collections WHERE id = ?').get(id); return r ? r.name : ''; }

  // ---------- чтение: артикул как строка таблицы ----------
  rows(where = '', ...args) {
    const list = this.db.prepare(`
      SELECT a.*, c.name AS collection, b.name AS brand, n.name AS network,
        (SELECT group_concat(g.name, ', ') FROM article_groups ag JOIN groups g ON g.id = ag.group_id WHERE ag.article_id = a.id) AS grp,
        (SELECT group_concat(value, ', ') FROM (SELECT value FROM article_values WHERE article_id = a.id AND field = 'usage' ORDER BY pos)) AS usage,
        (SELECT group_concat(value, ', ') FROM (SELECT value FROM article_values WHERE article_id = a.id AND field = 'design' ORDER BY pos)) AS design,
        (SELECT g.value FROM dict d JOIN dict g ON g.id = d.parent_id WHERE d.field = 'color' AND d.value = a.color) AS colorGroup
      FROM articles a JOIN collections c ON c.id = a.collection_id LEFT JOIN brands b ON b.id = COALESCE(a.brand_id, c.brand_id) LEFT JOIN networks n ON n.id = a.network_id
      ${where} ORDER BY a.id`).all(...args);
    return list.map((a) => {
      const o = { article: a.code, tm: a.brand ? a.brand + (a.grp ? ` (${a.grp})` : '') : '', collection: a.collection, usage: a.usage || '', design: a.design || '', colorGroup: a.colorGroup || '', status: joinStatus(a), brand: a.brand || '', group: a.grp || '' };
      for (const [k, col] of Object.entries(DIRECT)) if (!(k in o)) o[k] = fmtNum(a[col]);
      return o;
    });
  }
  rowOf(id) { return this.rows('WHERE a.id = ?', id)[0] || {}; }

  /** Сетка «как лист характеристик»: две строки заголовков + артикулы */
  grid() {
    const groupRow = []; const head = [];
    for (const [g, cols] of COLUMNS) cols.forEach(([, label], i) => { groupRow.push(i === 0 ? g : ''); head.push(label); });
    return [groupRow, head, ...this.rows().map((r) => FLAT.map(([k]) => r[k] || ''))];
  }
  /** Модель для чата — та же, что у Excel и Google Таблицы */
  model() {
    if (this.cache) return this.cache;
    const colors = [['Колір', 'Група']].concat(this.db.prepare("SELECT d.value, g.value AS grp FROM dict d LEFT JOIN dict g ON g.id = d.parent_id WHERE d.field = 'color' ORDER BY d.sort").all().map((r) => [r.value, r.grp || '']));
    this.cache = modelFromGrid(this.grid(), colors, { sheetName: 'База', title: 'База', docName: path.basename(this.file) });
    return this.cache;
  }

  // ---------- то же API, что у Excel и Google Таблицы ----------
  addRows(products, user = 'Вит', source = 'чат') {
    return this.tx(() => {
      for (const p of products) if (this.db.prepare('SELECT 1 FROM articles WHERE code = ? COLLATE NOCASE').get(clean(p.article))) throw new Error(`Артикул ${p.article} уже есть в базе`);
      for (const p of products) this.writeArticle(p, user, source);
      return { rows: products.map((p) => p.article) };
    });
  }
  updateRows(changes, user = 'Вит', source = 'чат') {
    return this.tx(() => {
      for (const ch of changes) {
        if (!this.db.prepare('SELECT 1 FROM articles WHERE code = ? COLLATE NOCASE').get(clean(ch.article))) throw new Error(`Артикул ${ch.article} в базе не найден`);
        this.writeArticle(Object.assign({ article: ch.article }, ch.fields), user, source);
      }
      return {};
    });
  }
  history(article, limit = 50) {
    return this.db.prepare("SELECT time, user, source, field, old, new FROM history WHERE entity = 'article' AND record = ? COLLATE NOCASE ORDER BY id DESC LIMIT ?").all(clean(article), limit);
  }

  /** Перенос всех данных из модели таблицы (Google или Excel). Только в пустую базу. */
  importModel(model, user = 'Вит', source = 'перенос из таблицы') {
    if (this.count()) throw new Error('В базе уже есть артикулы — перенос делается только один раз, в пустую базу');
    return this.tx(() => {
      // справочник цветов с группами (из листа «Кольори»)
      for (const [color, grp] of Object.entries(model.colors || {})) this.dictValue('color', color, grp ? this.dictValue('colorGroup', grp) : null);
      let n = 0;
      for (const r of model.rows) {
        const p = {}; for (const [k] of FLAT) if (k !== 'colorGroup' && k in r) p[k] = r[k];
        this.writeArticle(p, user, source); n++;
      }
      // основной бренд коллекции — тот, у которого больше артикулов
      this.db.exec(`UPDATE collections SET brand_id = (SELECT brand_id FROM articles a WHERE a.collection_id = collections.id AND brand_id IS NOT NULL GROUP BY brand_id ORDER BY COUNT(*) DESC LIMIT 1)`);
      this.db.prepare("DELETE FROM history WHERE source = ? AND field IS NULL").run(source); // «создан» на каждый артикул не нужен
      this.log(user, source, 'base', 'all', null, undefined, `перенесено артикулов: ${n}`);
      this.setMeta('imported', now());
      return n;
    });
  }

  /** Выгрузка в Excel в виде файла характеристик (для технолога и скриптов сайта/каталога) */
  async exportXlsx(file) {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Асортимент Актуал');
    const g = this.grid();
    g.forEach((row, i) => { const r = ws.addRow(row.map((v, j) => (i > 1 && ['thickness', 'pei', 'year', 'month', 'pcs', 'm2pack', 'w1', 'wpack', 'packsPal', 'm2pal', 'wpal'].includes(FLAT[j][0]) && v !== '' && Number.isFinite(Number(v)) ? Number(v) : v))); if (i < 2) r.font = { bold: true }; });
    ws.views = [{ state: 'frozen', ySplit: 2 }];
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: g.length, column: FLAT.length } };
    ws.columns.forEach((c, i) => { c.width = [10, 22, 18, 16][i] || 14; });
    const cs = wb.addWorksheet('Кольори'); cs.addRow(['Колір', 'Група']).font = { bold: true };
    for (const r of this.db.prepare("SELECT d.value, g.value AS grp FROM dict d LEFT JOIN dict g ON g.id = d.parent_id WHERE d.field = 'color' ORDER BY d.sort").all()) cs.addRow([r.value, r.grp || '']);
    await wb.xlsx.writeFile(file);
    return file;
  }
  /** Копия файла базы (раз в день при запуске и перед переносом) */
  backup(dir) {
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    const to = path.join(dir, `База_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.db`);
    if (!fs.existsSync(to)) this.db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`);
    const all = fs.readdirSync(dir).filter((f) => /^База_.*\.db$/.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - 30))) { try { fs.unlinkSync(path.join(dir, old)); } catch { /* не страшно */ } }
    return to;
  }
}
module.exports = { Db, splitTm, splitStatus, COLUMNS };
