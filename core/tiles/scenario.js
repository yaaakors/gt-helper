// Разговор про плитку: понять сообщение -> уточнить -> показать план -> выполнить по кнопке -> проверить.
// ИИ только понимает текст. Файлы и папки меняют обычные функции, и только после «Выполнить».
'use strict';
const sheet = require('./sheet');
const source = require('./source');
const folders = require('./folders');
const path = require('path');
const { understand, parseLocal, TM } = require('./parse');
const filesLib = require('./files');
const names = require('./names');

const ORDER = ['article', 'tm', 'collection', 'decor', 'purpose', 'usage', 'type', 'format', 'thickness', 'rect', 'color', 'surface', 'relief', 'frost', 'design', 'pei', 'ptv', 'r', 'ean', 'pcs', 'm2pack', 'w1', 'wpack', 'packsPal', 'm2pal', 'wpal', 'status', 'year', 'month', 'comment'];
// Разделы карточки артикула
const GROUPS = [
  ['Основное', ['tm', 'collection', 'decor', 'status', 'year', 'month']],
  ['Назначение', ['purpose', 'usage', 'type']],
  ['Размер', ['format', 'thickness', 'rect']],
  ['Внешний вид', ['color', 'colorGroup', 'surface', 'relief', 'design']],
  ['Технические', ['frost', 'pei', 'ptv', 'r']],
  ['Упаковка', ['ean', 'pcs', 'm2pack', 'w1', 'wpack', 'packsPal', 'm2pal', 'wpal']],
  ['Заметки', ['comment']],
];
const WANTED = ['purpose', 'usage', 'type', 'format', 'thickness', 'color', 'surface', 'relief', 'design', 'pei', 'r', 'ean']; // что напомнить, если пусто
const safeName = (s) => String(s).replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();
let seq = 0;
const uid = () => Date.now().toString(36) + (seq++).toString(36);

class TileChat {
  constructor({ store, journal, tasks, ai }) {
    this.store = store; this.journal = journal; this.tasks = tasks; this.ai = ai;
    this.draft = null; this.awaiting = null; this.plans = new Map(); this.lastArticles = [];
  }
  msg(text, extra) { return Object.assign({ id: uid(), from: 'bot', time: new Date().toISOString(), text }, extra || {}); }
  label(model, key) { return model.labels[key] || key; }

  async handle(text, files) {
    text = String(text || '').trim();
    if (!text && !(files && files.length)) return [];
    try {
      if (files && files.length) { this.awaiting = null; this.draft = null; return await this.handleFiles(text, files); }
      if (this.held && Date.now() - this.held.time < 15 * 60 * 1000 && !/^(отмена|отмени|стоп|не надо)$/iu.test(text) && text.split(/\s+/).length <= 8) { const h = this.held; this.held = null; if (source.configured(this.store)) return await this.planImages(await source.load(this.store), text, h.files); }
      this.held = null;
      // кнопка «Добавить <артикул>» после проверки выпуска
      const pick = /^Добавить ([\p{L}\d]+)$/u.exec(text);
      if (pick && this.fresh && this.fresh.has(pick[1].toLowerCase())) return await this.addFromRelease(this.fresh.get(pick[1].toLowerCase()));
      if (/^(помощь|помоги|что ты умеешь\??|help|\?)$/iu.test(text)) return [this.msg(HELP)];
      if (!this.awaiting && /^(отмена|отмени|стоп|не надо)$/iu.test(text)) {
        let n = 0; for (const pl of this.plans.values()) if (pl.status === 'pending') { pl.status = 'cancelled'; n++; }
        this.draft = null; return [this.msg(n ? 'Отменил, ничего не менялось.' : 'Отменять нечего — ничего не было начато.')];
      }
      if (this.awaiting) {
        const used = this.applyAnswer(text);
        if (used) return await this.advance();
        if (/^(отмена|отмени|стоп|не надо)$/iu.test(text)) { this.awaiting = null; this.draft = null; return [this.msg('Отменил, ничего не менялось.')]; }
        if (this.awaiting.key === 'article' && text.split(/\s+/).length <= 3) return [this.msg('Это не похоже на артикул: он пишется без пробелов и с цифрами, например FJ2580. Напишите артикул или выберите «без артикула».', { options: this.awaiting.options || [] })];
        if (this.awaiting.quiet && text.split(/\s+/).length <= 3) return [this.msg(`Не понял бренд. Напишите один из: ${(this.awaiting.options || []).join(', ')} — или «отмена».`)];
        if (text.split(/\s+/).length <= 3) return [this.msg('Не нашёл такого варианта. Выберите кнопкой ниже или напишите «отмена».', { options: this.awaiting.options || [] })];
        this.awaiting = null; this.draft = null; // человек написал другое — начинаем заново
      }
      if (/^(привет\p{L}*|здравствуй\p{L}*|добр\p{L}+ (день|утро|вечер)|доброго дня|в[іи]таю|хай|hello|hi)[\s!.,)]*$/iu.test(text)) return [this.msg('Здравствуйте! Напишите, что сделать: добавить артикул или коллекцию, создать папки, дополнить данные, показать, что есть по артикулу, или записать задачу. Примеры — по слову «помощь».')];
      if (/^(спасибо|благодарю|дякую|спс|ок|окей|хорошо|понял|ясно|добре|зрозум[іи]ло)[\s!.,)]*$/iu.test(text)) return [this.msg('Пожалуйста. Если что-то нужно — пишите.')];
      if (!source.configured(this.store)) return [this.msg('Сначала укажите в Настройках, где лежат характеристики: Excel-файл или Google Таблица.', { kind: 'warn' })];
      const model = await source.load(this.store);
      // «какие артикулы ещё не выпускались» — активные без даты выпуска
      if (/не\s+выпуска|не\s+выпущ|без\s+(даты\s+)?выпуска|ещ[её]\s+не\s+выш/iu.test(text) && !/добав|созда/iu.test(text)) {
        const list = model.rows.filter((r) => !String(r.year || '').trim() && !/^виведен/iu.test(r.status || ''));
        if (!list.length) return [this.msg('Таких нет: у всех действующих артикулов есть дата выпуска.')];
        const rows = list.slice(0, 80).map((r) => ({ label: r.article, value: [r.collection, r.color, r.format, r.tm].filter(Boolean).join(' · ') }));
        return [this.msg(`По документам есть, а в файлах выпуска ещё не встречались — артикулов: ${list.length}.`, { card: { title: 'Ещё не выпускались', rows, note: list.length > 80 ? `Показаны первые 80 из ${list.length}.` : 'Дата выпуска появится, когда артикул встретится в файле выпуска.', folder: '', open: '' } })];
      }
      let u; let note = '';
      const ai = this.ai && this.ai.ready() ? (s, t) => this.ai.json(s, t) : null;
      try { u = await understand(text, model, ai); } catch (e) {
        this.journal.add('error', 'ИИ не ответил, сообщение разобрано скриптом', { text, error: String(e.message || e) });
        u = await understand(text, model, null); note = 'ИИ сейчас не ответил, разобрал сообщение скриптом. ';
      }
      // коллекция названа кириллицей или с опечаткой, а такая уже есть — берём существующую
      for (const p of u.products || []) {
        if (!p.collection || model.collections.has(sheet.norm(p.collection))) continue;
        const hit = names.resolve(p.collection, [...model.collections.values()].map((c) => c.name));
        if (hit) { note += `«${p.collection}» понял как коллекцию ${hit}. `; p.collection = hit; }
      }
      // заводской код «FJ2580» → артикул характеристик «FJ258» (последний знак — сорт)
      for (const p of u.products || []) {
        if (!p.article || model.byArticle.has(p.article.toLowerCase()) || p.article.length !== model.articleLen + 1) continue;
        const short = p.article.slice(0, model.articleLen);
        note += `Артикул в характеристиках пишется без последнего знака (сорта): ${p.article} → ${short}. `;
        p.article = short;
      }
      if (u.intent === 'task') {
        const t = this.tasks.add(u.task || text);
        return [this.msg(`Записал в задачи: «${t.text}»`, { refresh: 'tasks' })];
      }
      // «ON099» или «что по ON099?» без новых значений — это вопрос, а не правка
      const bare = (p) => Object.keys(p).every((k) => k === 'article' || k === 'collection');
      if (u.intent === 'update' && u.products.length && u.products.every((p) => p.article && bare(p))) u.intent = 'info';
      if (u.intent === 'show' && u.products.length) { const r = await this.show(model, u.products, u.what || 'photo', text); if (note && r[0]) r[0].text = note + r[0].text; return r; }
      if (u.intent === 'info') { const r = await this.info(model, u.products, text); if (note && r[0]) r[0].text = note + r[0].text; return r; }
      if (u.intent === 'chat' && u.reply) return [this.msg(u.reply)];
      if (u.intent === 'add' || u.intent === 'update') {
        let products = u.products.length ? u.products : [{}];
        let mode = u.intent;
        // «PEI 4, R10» без артикула — это про последние добавленные
        if (mode === 'update' && products.every((p) => !p.article)) {
          if (!this.lastArticles.length) return this.unknown(text, 'Не понял, к какому артикулу это относится. Напишите артикул.');
          const f = products[0]; products = this.lastArticles.map((a) => Object.assign({}, f, { article: a }));
        }
        if (mode === 'add' && products.every((p) => p.article && model.byArticle.has(p.article.toLowerCase()))) mode = 'update';
        this.draft = { mode, products, source: text, note };
        return await this.advance();
      }
      return this.unknown(text);
    } catch (e) {
      this.draft = null; this.awaiting = null;
      this.journal.add('error', String(e.message || e), { text, stack: String(e.stack || '').split('\n').slice(0, 4) });
      return [this.msg('Не получилось: ' + (e.message || e) + '\nЗаписал в журнал разработчику.', { kind: 'bad' })];
    }
  }

  unknown(text, say) {
    this.journal.add('not_understood', text, { ai: !!(this.ai && this.ai.ready()) });
    return [this.msg((say || 'Эту команду я пока не умею выполнять.') + ' Записал в журнал разработчику — её добавят в обновлении.\n\nСейчас умею: добавить коллекцию или артикул, создать папки коллекции, дополнить данные артикула, показать данные и картинки по артикулу или коллекции, записать задачу. Напишите «помощь» для примеров.')];
  }

  /** Какой бренд предложить: по коллекции (какого больше) и по формату (у каких брендов такой формат) */
  brandGuess(model, p, known) {
    const base = (tm) => String(tm || '').replace(/\s*\(.*\)\s*$/, '').trim();
    const fk = (f) => String(f || '').toLowerCase().replace(/[^\d]+/g, 'x').replace(/^x|x$/g, '');
    const fmt = fk(p.format);
    const tally = (rows) => { const c = {}; for (const r of rows) { const b = base(r.tm); if (b) c[b] = (c[b] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1]); };
    const all = [...new Set((model.vocab.tm || []).map(base).filter(Boolean))];
    const or = (l) => (l.length > 1 ? l.slice(0, -1).join(', ') + ' или ' + l[l.length - 1] : l[0]);
    if (known) {
      const rows = model.rows.filter((r) => sheet.norm(r.collection) === sheet.norm(known.name));
      const same = fmt ? rows.filter((r) => fk(r.format) === fmt) : [];
      const t = tally(same.length ? same : rows); const list = t.map((x) => x[0]);
      if (tally(rows).length === 1) return { sure: true, list, all };
      const how = t.map((x) => `${x[0]} — ${x[1]}`).join(', ');
      if (list.length === 1) return { list, all, text: `В коллекции ${known.name} формат ${p.format} есть только у ${list[0]}. Это ${list[0]}?` };
      return { list, all, text: `В коллекции ${known.name} ${same.length ? 'с форматом ' + p.format : 'артикулов'}: ${how}. Это ${or(list)}?` };
    }
    const same = fmt ? model.rows.filter((r) => fk(r.format) === fmt) : [];
    const t = tally(same).filter((x) => x[1] >= same.length * 0.15).slice(0, 3); const list = t.map((x) => x[0]);
    if (!list.length) return { list, all, text: `Какой бренд у коллекции ${p.collection}? (${all.join(', ')})` };
    if (list.length === 1) return { list, all, text: `Коллекция ${p.collection} новая. По формату ${p.format} это скорее ${list[0]}. Это ${list[0]}?` };
    return { list, all, text: `Коллекция ${p.collection} новая. По формату ${p.format} это скорее ${or(list)}. Какой бренд?` };
  }
  applyAnswer(text) {
    const a = this.awaiting; const low = text.toLowerCase();
    let value = null;
    if (a.options && a.options.length) value = a.options.find((o) => o.toLowerCase() === low) || null;
    if (value === null && a.key === 'tm') {
      const sq = (x) => x.toLowerCase().replace(/[^\p{L}\d]/gu, '');
      if (a.yes && /^(да|ага|угу|верно|так|ок|ok|правильно|он|именно)[\s.!]*$/iu.test(low)) value = a.yes;
      else value = ((TM.find(([k]) => low.includes(k)) || [])[1]) || (a.options || []).find((o) => sq(o) === sq(low)) || (a.options || []).filter((o) => sq(low).includes(sq(o))).sort((x, y) => y.length - x.length)[0] || null;
    }
    if (a.key === 'article') {
      // «без артикула», «просто коллекцию», «нет» — значит нужны только папки
      if (value !== null || /^(без|нет|не надо|не нужен|пока нет|не знаю|только|просто|пропус)/iu.test(low)) { this.draft.foldersOnly = true; this.awaiting = null; return true; }
      // артикул — это код: буквы и цифры без пробелов, обязательно с цифрой
      if (!/^[\p{L}\d]{4,8}$/u.test(text) || !/\d/.test(text)) return false;
      value = text;
    }
    if (value === null && a.free && text.split(/\s+/).length <= 5 && !/добав|обнов|задач/iu.test(low)) value = text;
    if (value === null) return false;
    if (a.skip && value === a.skip) value = '';
    for (const p of this.draft.products) if (a.all ? (p === a.product || !p[a.key]) : p === a.product) { p[a.key] = value; if (value === '') (p._skipped = p._skipped || {})[a.key] = true; }
    this.awaiting = null;
    return true;
  }
  ask(text, key, product, opts) {
    this.awaiting = Object.assign({ key, product }, opts || {});
    return [this.msg((this.draft.note || '') + text, { options: this.awaiting.quiet ? [] : this.awaiting.options || [] })];
  }

  async advance() {
    const model = await source.load(this.store);
    const d = this.draft; const L = (k) => this.label(model, k);
    return d.mode === 'add' ? this.advanceAdd(model, d, L) : this.advanceUpdate(model, d, L);
  }

  /** Привести значения к виду файла и найти то, чего в справочниках нет */
  normalize(model, p) {
    const problems = [];
    if (p.format) p.format = String(p.format).replace(/\s/g, '').replace(/[xX×*]/g, 'х');
    if (p.thickness) p.thickness = String(p.thickness).replace(',', '.');
    for (const key of sheet.CLOSED) {
      if (!p[key] || (p._skipped && p._skipped[key])) continue;
      const list = key === 'color' && Object.keys(model.colors).length ? Object.keys(model.colors) : (model.vocab[key] || []);
      const hit = list.find((v) => v.toLowerCase() === String(p[key]).toLowerCase());
      if (hit) p[key] = hit; else problems.push({ key, value: p[key], list });
    }
    return problems;
  }

  async advanceAdd(model, d, L) {
    const many = d.products.length > 1;
    for (const p of d.products) {
      if (!p.article) {
        if (d.foldersOnly === undefined && /папк|пуст\p{L}*\s|без\s+артикул|(только|просто)\s+кол+е[кц]/iu.test(d.source + ' ')) d.foldersOnly = true;
        if (d.foldersOnly) return this.planFolders(model, d);
        let pre = '';
        const known = p.collection && model.collections.get(sheet.norm(p.collection));
        if (known) {
          const n = model.rows.filter((r) => sheet.norm(r.collection) === sheet.norm(p.collection)).length;
          const dir = await this.whereFolder(known.name);
          pre = `Коллекция ${known.name} уже есть в характеристиках (артикулов — ${n})` + (dir ? `, папка тоже есть: ${dir}` : '') + '. ';
          return this.ask(pre + 'Какой артикул добавить в неё?', 'article', p, { free: true, options: ['Без артикула — только папки'] });
        }
        return this.ask('Какой артикул? Если артикула пока нет — создам только папки коллекции.', 'article', p, { free: true, options: ['Без артикула — только папки'] });
      }
      if (model.byArticle.has(p.article.toLowerCase())) {
        const ex = model.byArticle.get(p.article.toLowerCase());
        this.draft = null;
        return [this.msg(`Артикул ${ex.article} уже есть в характеристиках (${ex.collection}, строка ${ex.row}). Если нужно изменить его данные — напишите, например: «для ${ex.article} цвет бежевый».`, { kind: 'warn' })];
      }
      if (!p.collection) return this.ask(`Как называется коллекция${many ? ' для ' + p.article : ''}?`, 'collection', p, { free: true, all: !many || d.products.every((x) => !x.collection) });
      const known = model.collections.get(sheet.norm(p.collection));
      if (known) p.collection = known.name;
      // бренд: один у коллекции — берём; иначе предлагаем по формату и по тому, какого бренда больше (текстом, без кнопок)
      if (!p.tm) {
        const g = this.brandGuess(model, p, known);
        if (g.sure) { p.tm = g.list[0]; (p._auto = p._auto || {}).tm = 'как у коллекции'; }
        else return this.ask(g.text, 'tm', p, { options: g.all, yes: g.list.length === 1 ? g.list[0] : null, quiet: true, all: true });
      }
      for (const pr of this.normalize(model, p)) {
        const first = String(pr.value).toLowerCase().slice(0, 3);
        const close = pr.list.filter((v) => v.toLowerCase().includes(first));
        const options = (close.length ? close : pr.list).slice(0, 14).concat(['пропустить']);
        return this.ask(`В характеристиках нет значения «${pr.value}» для поля «${L(pr.key)}». Выберите из существующих или пропустите — заполните позже.`, pr.key, p, { options, skip: 'пропустить', all: d.products.every((x) => x[pr.key] === pr.value) });
      }
      // правила: считаем сами
      p._auto = p._auto || {};
      if (!p.rect && p.format && p.type && model.rectRule[p.format + '|' + p.type]) { p.rect = model.rectRule[p.format + '|' + p.type]; p._auto.rect = 'по формату'; }
      if (!p.frost && p.type && model.frostRule[p.type]) { p.frost = model.frostRule[p.type]; p._auto.frost = 'по типу'; }
      if (!p.status) { p.status = (model.vocab.status || []).find((s) => /^актив/i.test(s)) || ''; if (p.status) p._auto.status = 'по умолчанию'; }
      // дата выпуска — только по факту, из файла выпуска; при ручном добавлении остаётся пустой
      if (d.release && !p.year) { p.year = String(d.release.year); p._auto.year = 'из файла выпуска'; if (model.cols.month) { p.month = String(d.release.month); p._auto.month = 'из файла выпуска'; } }
      if (!model.cols.month) delete p.month;
    }
    // план
    const warnings = [];
    for (const p of d.products) {
      if (p.format && !(model.vocab.format || []).includes(p.format)) warnings.push(`Формат ${p.format} — новый, такого в характеристиках ещё нет.`);
      if (p.format && p.type && !p.rect) warnings.push(`Ректифікат для ${p.format} не знаю — таких ещё не было. Останется пустым.`);
    }
    if (d.products.some((p) => !p.year)) warnings.push('Дата выпуска пока пустая — поставлю её, когда артикул появится в файле выпуска.');
    const plan = {
      id: uid(), mode: 'add', status: 'pending', warnings: [...new Set(warnings)],
      products: d.products.map((p) => this.view(model, p)),
      raw: d.products.map((p) => { const c = {}; for (const k of ORDER) if (p[k]) c[k] = p[k]; return c; }),
      target: source.title(this.store),
      folders: await this.folderPlan(d.products),
    };
    this.plans.set(plan.id, plan); this.draft = null; this.awaiting = null;
    const n = plan.products.length;
    return [this.msg((d.note || '') + (n === 1 ? `Понял. Вот что сделаю для ${plan.raw[0].article}:` : `Понял, артикулов: ${n}. Вот что сделаю:`), { plan })];
  }

  /** Файлы, брошенные в чат: смотрим, что внутри, и делаем то, что умеем */
  async handleFiles(text, files) {
    if (!source.configured(this.store)) return [this.msg('Сначала укажите в Настройках, где лежат характеристики: Excel-файл или Google Таблица.', { kind: 'warn' })];
    const model = await source.load(this.store);
    const out = []; const releases = []; const packs = []; const other = []; const images = [];
    for (const f of files) {
      const name = path.basename(f);
      if (filesLib.kindOf(f) === 'image') { images.push(f); continue; }
      if (filesLib.kindOf(f) !== 'excel') { other.push(name); continue; }
      let grid;
      try { grid = filesLib.readGrid(f).grid; } catch (e) { out.push(this.msg(`Не смог прочитать «${name}»: ${e.message || e}`, { kind: 'bad' })); this.journal.add('failed', 'Чтение файла из чата', { name, error: String(e.message || e) }); continue; }
      const type = filesLib.detect(grid);
      if (type === 'release') releases.push({ name, grid, date: filesLib.releaseDate(f) }); else if (type === 'pack') packs.push({ name, grid }); else other.push(name);
    }
    if (releases.length) {
      let checked = 0; const fresh = new Map(); const first = new Map();
      const earlier = (a, b) => a.year * 12 + a.month < b.year * 12 + b.month;
      for (const r of releases) {
        const res = filesLib.releaseCheck(r.grid, model); checked += res.checked;
        for (const x of res.fresh) if (!fresh.has(x.article.toLowerCase())) fresh.set(x.article.toLowerCase(), Object.assign(x, { release: r.date }));
        for (const x of res.first) { const k = x.article.toLowerCase(); if (!first.has(k) || earlier(r.date, first.get(k).release)) first.set(k, Object.assign(x, { release: r.date })); }
      }
      const head = `Проверил выпуск: файлов — ${releases.length}, строк первого сорта — ${checked}. `;
      this._first = first;
      if (!fresh.size) out.push(this.msg(head.trim(), { results: [{ ok: true, text: 'Новых артикулов нет — все уже есть в характеристиках.' }] }));
      else {
        this.fresh = fresh; const list = [...fresh.values()];
        out.push(this.msg(head + `Новых артикулов — ${list.length}:\n\n` + list.map((x) => `${x.collection} - ${x.article} - ${x.name}`).join('\n') + '\n\nМогу завести их в характеристики — нажмите кнопку, покажу план.', { options: list.slice(0, 12).map((x) => 'Добавить ' + x.article) }));
      }
    }
    if (releases.length && this._first && this._first.size) {
      // артикул был в характеристиках без даты выпуска и впервые встретился в файле выпуска → проставить год и месяц
      const list = [...this._first.values()]; this._first = null;
      const mm = (r) => String(r.month).padStart(2, '0') + '.' + r.year;
      const fields = (r) => (model.cols.month ? { year: String(r.year), month: String(r.month) } : { year: String(r.year) });
      const view = list.map((x) => ({ article: x.article, collection: x.collection, rows: Object.entries(fields(x.release)).map(([k, v]) => ({ key: k, label: this.label(model, k), from: '', value: v })) }));
      const plan = { id: uid(), mode: 'update', status: 'pending', warnings: [], changes: list.map((x) => ({ article: x.article, fields: fields(x.release) })), view, target: source.title(this.store) };
      if (!model.cols.month) plan.warnings.push('В характеристиках нет колонки «Місяць випуску» — запишу только год. Добавьте такую колонку рядом с «Рік випуску SKU», и я буду писать месяц.');
      if (releases.some((r) => r.date.from === 'file')) plan.warnings.push('В имени файла выпуска нет даты (жду вид «Выпуск 12_11») — взял дату самого файла. Проверьте месяц.');
      this.plans.set(plan.id, plan);
      out.push(this.msg(`Впервые в выпуске — артикулов: ${list.length} (${list.map((x) => x.article).join(', ')}). До сих пор они были без даты выпуска. Проставлю ${[...new Set(list.map((x) => mm(x.release)))].join(', ')}:`, { plan }));
    }
    for (const pk of packs) {
      let d;
      try { d = filesLib.packDiff(pk.grid, model); } catch (e) { out.push(this.msg(`«${pk.name}»: ${e.message || e}`, { kind: 'bad' })); continue; }
      const tail = d.unknown ? ` Ещё ${d.unknown} кодов из файла в характеристиках нет — их не трогаю.` : '';
      if (!d.changes.length) { out.push(this.msg(`Сверил упаковку по файлу «${pk.name}»: артикулов — ${d.matched}, отличий нет — обновлять нечего.` + tail)); continue; }
      const view = d.changes.map((c) => ({ article: c.article, collection: c.collection, rows: Object.entries(c.fields).map(([k, v]) => ({ key: k, label: this.label(model, k), from: model.byArticle.get(c.article.toLowerCase())[k], value: v })) }));
      const plan = { id: uid(), mode: 'update', status: 'pending', warnings: [], changes: d.changes.map((c) => ({ article: c.article, fields: c.fields })), view, target: source.title(this.store) };
      this.plans.set(plan.id, plan);
      out.push(this.msg(`Сверил упаковку по файлу «${pk.name}»: артикулов — ${d.matched}, с отличиями — ${d.changes.length}.` + tail + ' Вот что изменю:', { plan }));
    }
    if (images.length) out.push(...await this.planImages(model, text, images));
    if (other.length) {
      this.journal.add('not_understood', text || '(файлы без подписи)', { files: other });
      out.push(this.msg(`${other.length === 1 ? 'Файл' : 'Файлы'} ${other.map((n) => `«${n}»`).join(', ')} принял, но работать с такими пока не умею. Сейчас понимаю файлы выпуска плитки, файл упаковочных данных и картинки (раскладываю по папкам коллекции). Записал в журнал разработчику — добавят в обновлении.`));
    }
    return out;
  }

  /** Картинки из чата → план «скопировать в папку коллекции» (Faces / Рендери / Живі фото та відео) */
  async planImages(model, text, files) {
    const low = String(text || '').toLowerCase();
    const sub = /фейс|face|лиц/iu.test(low) ? folders.SUBDIRS[0] : /рендер|визуал|візуал|интерьер|інтер/iu.test(low) ? folders.SUBDIRS[1] : /жив|видео|відео|фото/iu.test(low) ? folders.SUBDIRS[2] : null;
    // коллекция: самое длинное название из характеристик, которое есть в подписи
    const sq = (x) => sheet.norm(x).replace(/[^\p{L}\d]/gu, '');
    let coll = null;
    for (const c of model.collections.values()) if (sq(c.name).length >= 3 && sq(low).includes(sq(c.name)) && (!coll || c.name.length > coll.name.length)) coll = c;
    if (!coll) { const hit = names.find(text, [...model.collections.values()].map((c) => c.name)); if (hit) coll = model.collections.get(sheet.norm(hit)); }
    // второе название, которого нет в характеристиках (например, выведенное) — берём основную коллекцию
    if (!coll) for (const t of this.twins()) if (sq(low).includes(sq(t.name))) coll = model.collections.get(sheet.norm(t.base)) || { name: t.base, tm: {} };
    if (!sub || !coll) {
      this.held = { files, time: Date.now() };
      const what = !sub && !coll ? 'что это за картинки и для какой коллекции' : !sub ? 'что это за картинки: фейсы, рендеры или живые фото' : 'для какой коллекции (в подписи не нашёл названия из характеристик)';
      return [this.msg(`Картинок принял — ${files.length}. Напишите, ${what}. Например: «фейсы в Kassel». Заново прикладывать не нужно.`)];
    }
    this.held = null;
    const root = this.store.get('catalogRoot');
    if (!root) return [this.msg('В Настройках не указана папка каталога на сети — положить картинки некуда.', { kind: 'warn' })];
    const ix = await folders.index(root);
    if (!ix) return [this.msg(`Сетевая папка сейчас недоступна (${root}). Попробуйте позже — картинки приложите ещё раз.`, { kind: 'bad' })];
    let found = folders.find(ix, coll.name); let viaBase = '';
    if (!found && this.baseOf(coll.name)) { viaBase = this.baseOf(coll.name); found = folders.find(ix, viaBase); }
    if (!found) return [this.msg(`У коллекции ${coll.name} ещё нет папки на сети. Сначала напишите «создай папки для ${coll.name}», потом приложите картинки ещё раз.`, { kind: 'warn' })];
    const dir = path.join(found.dir, sub);
    // имя файла: вместо второго названия (Denver) — основное название коллекции (Kassel)
    const target = viaBase || coll.name;
    const alias = [...new Set([coll.name, ...this.twins().filter((t) => sheet.norm(t.base) === sheet.norm(target)).map((t) => t.name)])].filter((n) => sheet.norm(n) !== sheet.norm(target));
    const fix = (name) => { for (const a of alias) { const re = new RegExp('^' + a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]+') + '(?=[\\s_.-])', 'i'); if (re.test(name)) return name.replace(re, target.replace(/\s+/g, '_')); } return name; };
    // фейсы лежат в подпапках «формат_цвет» (1200х600_grey): берём формат и цвет из имени файла
    const subs = sub === folders.SUBDIRS[0] ? ((await folders.subdirs(dir)) || []) : [];
    const xk = (v) => v.toLowerCase().replace(/[xх×]/g, 'x');
    const place = (name) => {
      if (sub !== folders.SUBDIRS[0]) return '';
      const parts = name.replace(/\.[^.]+$/, '').split(/[_\s]+/).filter(Boolean);
      const fi = parts.findIndex((t) => /^\d{2,4}[xхX×Х]\d{2,4}$/.test(t)); if (fi < 0) return null;
      const nameLen = target.split(/\s+/).length;
      const color = parts.filter((t, k) => k >= nameLen && k !== fi && !/^fr\d*$/i.test(t) && !/^\d+$/.test(t)).join('_'); if (!color) return null;
      const want = parts[fi].replace(/[xX×Х]/g, 'х') + '_' + color;
      return subs.find((d) => xk(d) === xk(want)) || want;
    };
    const items = []; const seen = new Map(); let loose = 0;
    for (const f of files) {
      const name = fix(path.basename(f)); let folder = place(name);
      if (folder === null) { folder = ''; loose++; }
      const key = folder.toLowerCase();
      if (!seen.has(key)) seen.set(key, new Set(((await folders.images(path.join(dir, folder))) || []).map((n) => n.toLowerCase())));
      items.push({ src: f, name, was: name !== path.basename(f) ? path.basename(f) : '', folder, isNew: !!folder && !subs.some((d) => d === folder), exists: seen.get(key).has(name.toLowerCase()) });
    }
    items.sort((a, b) => a.folder.localeCompare(b.folder));
    const plan = { id: uid(), mode: 'files', status: 'pending', warnings: [], dir, sub, collection: target, items };
    if (loose) plan.warnings.push(`В имени ${loose === 1 ? 'файла' : 'части файлов'} не нашёл формат и цвет (жду вид «Kassel_grey_1200x600_fr1») — положу прямо в Faces, без подпапки.`);
    if (viaBase) plan.warnings.push(`У ${coll.name} своей папки нет — это ${viaBase} под другим названием. Кладу в папку ${viaBase}.`);
    const brandsIn = Object.keys(coll.tm || {});
    if (brandsIn.length > 1) plan.warnings.push(`У коллекции несколько брендов (${brandsIn.join(', ')}). Кладу в папку: ${found.parent}. Если нужна другая — скажите.`);
    if (items.every((i) => i.exists)) { plan.status = 'done'; return [this.msg(`Все эти файлы уже лежат в папке ${[...new Set(items.map((i) => path.join(dir, i.folder)))].join(', ')} — копировать нечего.`)]; }
    this.plans.set(plan.id, plan);
    return [this.msg(`Понял. Вот что сделаю с картинками для ${target}:`, { plan })];
  }

  /** Новый артикул из файла выпуска → обычный план добавления (данные берём из заводского названия) */
  async addFromRelease(x) {
    const model = await source.load(this.store);
    const f = (parseLocal(x.name, model).products[0]) || {};
    delete f.article;
    const known = model.collections.get(sheet.norm(x.collection));
    const title = (t) => t.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    const p = Object.assign(f, { article: x.article, collection: known ? known.name : (f.collection && sheet.norm(f.collection).startsWith(sheet.norm(x.collection)) ? f.collection : title(x.collection)) });
    this.draft = { mode: 'add', products: [p], source: x.name, release: x.release, note: `Данные взял из названия в файле выпуска: «${x.name}». Проверьте их в плане. ` };
    return await this.advance();
  }

  /** Вторые названия коллекций для других рынков: Denver = Kassel (Польша). Список — twins.json в папке данных */
  twins() { return this.store.read('twins.json', TWINS); }
  /** Основная коллекция для второго названия (или null) */
  baseOf(collection) { const k = sheet.norm(collection); const t = this.twins().find((x) => sheet.norm(x.name) === k); return t ? t.base : null; }
  /** Строка для карточки: «Другое название: …» */
  twinLine(collection) {
    const k = sheet.norm(collection); const all = this.twins();
    const up = all.find((x) => sheet.norm(x.name) === k);
    if (up) return `Это коллекция ${up.base} под названием для рынка: ${up.market}.` + (up.old ? ' Название выведено.' : '');
    const down = all.filter((x) => sheet.norm(x.base) === k);
    return down.length ? 'Другие названия: ' + down.map((x) => `${x.name} (${x.market}${x.old ? ', выведено' : ''})`).join(', ') + '.' : '';
  }

  /** Где лежит папка коллекции (если каталог доступен). У второго названия своей папки может не быть — тогда папка основной */
  async whereFolder(collection) {
    const ix = await folders.index(this.store.get('catalogRoot'));
    if (!ix) return null;
    let e = folders.find(ix, safeName(collection));
    if (!e && this.baseOf(collection)) e = folders.find(ix, safeName(this.baseOf(collection)));
    return e ? e.dir : '';
  }

  /** Ответ на вопрос: что есть по артикулу или коллекции. Ничего не меняет. */
  async info(model, products, text) {
    const out = [];
    for (const p of products) {
      if (p.article) {
        const rec = model.byArticle.get(p.article.toLowerCase());
        if (!rec) { out.push(this.msg(this.noArticle(model, p.article))); continue; }
        const sections = []; const empty = [];
        for (const [title, keys] of GROUPS) {
          const rows = [];
          for (const k of keys) { if (!model.cols[k]) continue; if (rec[k]) rows.push({ label: this.label(model, k), value: rec[k] }); else if (WANTED.includes(k)) empty.push(this.label(model, k)); }
          if (rows.length) sections.push({ title, rows });
        }
        const dir = rec.collection ? await this.whereFolder(rec.collection) : null;
        const photo = dir ? (await folders.productPhotos(dir, rec.article))[0] : '';
        out.push(this.msg(`Вот что есть по ${rec.article}:`, { card: { title: [rec.article, rec.collection, rec.color, rec.format].filter(Boolean).join(' · '), sections, rows: [], photo: photo ? path.join(dir, photo) : '',
          note: [!String(rec.year || '').trim() && !/^виведен/iu.test(rec.status || '') && 'Ещё не выпускалась: в файлах выпуска артикул не встречался.', rec.collection && this.twinLine(rec.collection), empty.length ? 'Не заполнено: ' + empty.join(', ') : ''].filter(Boolean).join(' '), folder: dir === null ? '' : (dir || 'Папки коллекции в каталоге нет.'), open: dir || '' } }));
      } else if (p.collection) {
        const key = sheet.norm(p.collection);
        const list = model.rows.filter((r) => sheet.norm(r.collection) === key);
        const dir = await this.whereFolder(p.collection);
        if (!list.length) { out.push(this.msg(`Коллекции ${p.collection} в характеристиках нет.` + (dir ? ` Но папка в каталоге есть: ${dir}` : ''), dir ? { card: { title: p.collection, rows: [], note: '', folder: dir, open: dir } } : {})); continue; }
        const rows = list.slice(0, 60).map((r) => ({ label: r.article, value: [r.color, r.format, r.surface, r.decor, r.status && !/^актив/i.test(r.status) ? r.status : ''].filter(Boolean).join(' · ') }));
        out.push(this.msg(`Коллекция ${list[0].collection}: артикулов — ${list.length}.`, { card: { title: `${list[0].collection} · ${[...new Set(list.map((r) => r.tm))].join(', ')}`, rows, note: [this.twinLine(list[0].collection), list.length > 60 ? `Показаны первые 60 из ${list.length}.` : ''].filter(Boolean).join(' '), folder: dir === null ? '' : (dir || 'Папки коллекции в каталоге нет.'), open: dir || '' } }));
      }
    }
    return out.length ? out : this.unknown(text, 'Не понял, про какой артикул или коллекцию вопрос.');
  }
  noArticle(model, article) {
    const head = article.toLowerCase().slice(0, 3);
    const near = model.rows.filter((r) => r.article.toLowerCase().startsWith(head)).slice(0, 8).map((r) => r.article);
    return `Артикула ${article} в характеристиках нет.` + (near.length ? ` Похожие: ${near.join(', ')}.` : '');
  }

  /** Показать картинки: фото плитки по артикулу или визуализации коллекции. Берём из папки коллекции в каталоге. */
  async show(model, products, what, text) {
    const out = [];
    for (const p of products) {
      let collection = p.collection; let rec = null;
      if (p.article) { rec = model.byArticle.get(p.article.toLowerCase()); if (!rec) { out.push(this.msg(this.noArticle(model, p.article))); continue; } collection = rec.collection; }
      if (!collection) continue;
      const known = model.collections.get(sheet.norm(collection)); const name = known ? known.name : collection;
      const dir = await this.whereFolder(name);
      if (dir === null) { out.push(this.msg('Папка каталога на сети сейчас недоступна (или не указана в Настройках) — показать картинки не могу.', { kind: 'warn' })); continue; }
      if (!dir) { out.push(this.msg(`Папки коллекции ${name} в каталоге нет — картинок показать не могу.`)); continue; }
      let files; let title; let none;
      if (what === 'renders') {
        files = await folders.renders(dir); title = `Визуализации · ${name}`; none = `В папке «Рендери» коллекции ${name} картинок нет.`;
        if (rec) { // если спросили про артикул — сначала те, где он упомянут по цвету и формату
          const words = [rec.format && rec.format.replace(/[хx]/gi, 'x')].filter(Boolean);
          const mine = files.filter((f) => words.every((w) => path.basename(f).toLowerCase().replace(/[хx×]/g, 'x').includes(w.toLowerCase())));
          if (mine.length) files = mine;
        }
      } else {
        files = (await folders.productPhotos(dir, rec ? rec.article : '')).map((n) => path.join(dir, n));
        title = rec ? `Фото плитки · ${rec.article} · ${name}` : `Фото плиток · ${name}`;
        none = rec ? `Фото артикула ${rec.article} в папке коллекции не нашёл. Оно должно лежать в ${dir} и называться «… - ${rec.article}.jpg».` : `В папке коллекции ${name} фото плиток нет.`;
      }
      if (!files.length) { out.push(this.msg(none, { card: { title: name, rows: [], note: '', folder: dir, open: dir } })); continue; }
      out.push(this.msg(files.length === 1 ? 'Вот:' : `Нашёл картинок: ${files.length}.` + (files.length > 8 ? ' Показываю первые 8, остальные — в папке.' : ''),
        { gallery: { title, items: files.slice(0, 8).map((f) => ({ path: f, name: path.basename(f) })), total: files.length, folder: what === 'renders' ? path.join(dir, folders.SUBDIRS[1]) : dir } }));
    }
    return out.length ? out : this.unknown(text, 'Не понял, по какому артикулу или коллекции показать картинки.');
  }

  /** Только папки коллекции, без строки в характеристиках */
  async planFolders(model, d) {
    const p = d.products.find((x) => x.collection) || d.products[0];
    if (!p.collection) return this.ask('Как называется коллекция?', 'collection', p, { free: true, all: true });
    const known = model.collections.get(sheet.norm(p.collection));
    if (known) {
      p.collection = known.name;
      if (!p.tm) {
        const g = this.brandGuess(model, p, known);
        if (g.sure) p.tm = g.list[0];
        else return this.ask(g.text, 'tm', p, { options: g.all, yes: g.list.length === 1 ? g.list[0] : null, quiet: true, all: true });
      }
    }
    const fp = await this.folderPlan([p]);
    // папка уже есть и в ней всё на месте — создавать нечего, так и говорим
    if (fp.length && fp.every((f) => f.exists && !f.missing.length)) {
      this.draft = null; this.awaiting = null;
      const dir = path.join(fp[0].root, fp[0].parent, fp[0].collection);
      return [this.msg(`Папка коллекции ${fp[0].collection} уже существует, все три подпапки на месте — создавать нечего.`, { card: { title: fp[0].collection, rows: [], note: '', folder: dir, open: dir } })];
    }
    const some = fp.some((f) => f.exists);
    const plan = { id: uid(), mode: 'folders', status: 'pending', warnings: [], products: [], raw: [], target: source.title(this.store), folders: fp };
    this.plans.set(plan.id, plan); this.draft = null; this.awaiting = null;
    return [this.msg(some ? `Папка коллекции ${p.collection} уже существует, но в ней не хватает подпапок. Досоздам недостающие:` : `Понял. Создам только папки коллекции ${p.collection} — в характеристики ничего не добавляю:`, { plan })];
  }

  view(model, p) {
    const rows = []; const empty = [];
    for (const k of ORDER) {
      if (p[k]) rows.push({ key: k, label: this.label(model, k), value: String(p[k]), auto: (p._auto && p._auto[k]) || '' });
      else if (WANTED.includes(k) && model.cols[k]) empty.push(this.label(model, k));
    }
    if (p.color && model.colors[p.color]) rows.splice(rows.findIndex((r) => r.key === 'color') + 1, 0, { key: 'colorGroup', label: this.label(model, 'colorGroup') || 'Група кольору', value: model.colors[p.color], auto: 'по цвету' });
    return { article: p.article, rows, empty };
  }

  async folderPlan(products) {
    const root = this.store.get('catalogRoot');
    const groups = new Map();
    for (const p of products) groups.set(p.tm + '|' + p.collection, { tm: p.tm, status: p.status, collection: safeName(p.collection) });
    const ix = await folders.index(root);
    const out = [];
    for (const g of groups.values()) {
      const f = { tm: g.tm, collection: g.collection, root, subs: folders.SUBDIRS, state: 'ready', parent: null, parents: ix ? ix.tops : [], why: '' };
      if (!root) f.state = 'no_root';
      else if (!ix) f.state = 'unreachable';
      else {
        const ex = folders.find(ix, g.collection);
        if (ex) { f.parent = ex.parent; f.collection = ex.name; f.why = 'папка коллекции уже есть'; f.exists = true; f.missing = folders.missingSubs(root, ex.parent, ex.name); } else {
          const d = folders.defaultParent(ix.tops, g, new Date().getFullYear());
          if (d) { f.parent = d.parent; f.why = d.why; } else f.state = 'need_parent';
        }
      }
      out.push(f);
    }
    return out;
  }

  async advanceUpdate(model, d, L) {
    const changes = []; const view = [];
    for (const p of d.products) {
      if (!p.article) return this.ask('К какому артикулу это относится?', 'article', p, { free: true });
      const ex = model.byArticle.get(p.article.toLowerCase());
      if (!ex) { this.draft = null; return [this.msg(`Артикула ${p.article} в характеристиках нет. Чтобы добавить его, напишите: «добавь ${p.article}, коллекция …».`, { kind: 'warn' })]; }
      for (const pr of this.normalize(model, p)) {
        const first = String(pr.value).toLowerCase().slice(0, 3);
        const close = pr.list.filter((v) => v.toLowerCase().includes(first));
        return this.ask(`В характеристиках нет значения «${pr.value}» для поля «${L(pr.key)}». Выберите из существующих или пропустите.`, pr.key, p, { options: (close.length ? close : pr.list).slice(0, 14).concat(['пропустить']), skip: 'пропустить', all: d.products.every((x) => x[pr.key] === pr.value) });
      }
      const fields = {}; const rows = [];
      for (const k of ORDER) {
        if (k === 'article' || !p[k] || !model.cols[k]) continue;
        if (k === 'collection' && sheet.norm(p[k]) === sheet.norm(ex.collection)) continue;
        if (String(p[k]) === ex[k]) continue;
        fields[k] = p[k]; rows.push({ key: k, label: L(k), from: ex[k], value: String(p[k]) });
      }
      if (Object.keys(fields).length) { changes.push({ article: ex.article, fields }); view.push({ article: ex.article, collection: ex.collection, rows }); }
    }
    this.draft = null; this.awaiting = null;
    if (!changes.length) return [this.msg('Менять нечего: такие значения уже стоят.')];
    const plan = { id: uid(), mode: 'update', status: 'pending', warnings: [], changes, view, target: source.title(this.store) };
    this.plans.set(plan.id, plan);
    return [this.msg((d.note || '') + 'Понял. Вот что изменю:', { plan })];
  }

  cancel(planId) {
    const plan = this.plans.get(planId);
    if (plan && plan.status === 'pending') plan.status = 'cancelled';
    return [this.msg('Отменил, ничего не менялось.', { planUpdate: { id: planId, status: 'cancelled' } })];
  }

  /** Выполнить план. opts.brands: {«ТМ|Колекція»: папка бренда} — выбор человека */
  async execute(planId, opts) {
    const plan = this.plans.get(planId);
    if (!plan || !['pending', 'failed'].includes(plan.status)) return [this.msg('Этот план уже не действует. Напишите команду заново.')];
    const results = []; const backupDir = this.store.file('backups');
    if (plan.mode === 'files') {
      const fs = require('fs');
      try { fs.mkdirSync(plan.dir, { recursive: true }); } catch (e) { /* ниже будет понятная ошибка по каждому файлу */ }
      let done = 0; let skipped = 0;
      for (const it of plan.items) {
        if (it.done) continue;
        const dest = path.join(plan.dir, it.folder || '', it.name);
        try {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          if (fs.existsSync(dest)) { skipped++; it.done = true; continue; }
          fs.copyFileSync(it.src, dest, fs.constants.COPYFILE_EXCL);
          if (fs.statSync(dest).size !== fs.statSync(it.src).size) throw new Error('размер копии не совпал с исходным');
          it.done = true; done++;
        } catch (e) {
          results.push({ ok: false, text: `${it.name}: ${e.message || e}` });
          this.journal.add('failed', 'Копирование картинки в папку коллекции', { file: it.name, dir: plan.dir, error: String(e.message || e) });
        }
      }
      const where = [...new Set(plan.items.map((i) => path.join(plan.dir, i.folder || '')))];
      if (done) { results.unshift({ ok: true, text: `Скопировано файлов — ${done}: ${where.join(', ')}`, open: where[0] }); folders.reset(); }
      if (skipped) results.push({ ok: null, text: `Пропущено — ${skipped}: файлы с такими именами там уже лежат, не заменял.` });
      const bad = results.some((r) => r.ok === false);
      plan.status = bad ? 'failed' : 'done';
      return [this.msg(bad ? 'Скопировал не всё. Исправьте причину и нажмите «Повторить» — уже скопированное не повторится.' : 'Готово. Исходные файлы остались на месте.', { results, kind: bad ? 'bad' : 'ok', planUpdate: { id: planId, status: plan.status } })];
    }
    let sheetOk = plan.sheetDone === true || plan.mode === 'folders';
    if (!sheetOk) {
      try {
        if (plan.mode === 'add') {
          const r = await source.addRows(this.store, plan.raw, backupDir);
          results.push(r.backup ? { ok: true, text: `${plan.target}: добавлено строк — ${r.rows.length} (строки ${r.rows.join(', ')}). Проверено повторным чтением.`, note: 'Копия до изменения: ' + r.backup } : { ok: true, text: `${plan.target}: добавлено артикулов — ${r.rows.length} (${r.rows.join(', ')}). Изменение записано в историю.` });
        } else {
          const r = await source.updateRows(this.store, plan.changes, backupDir);
          results.push(r.backup ? { ok: true, text: `${plan.target}: изменено артикулов — ${plan.changes.length}. Проверено повторным чтением.`, note: 'Копия до изменения: ' + r.backup } : { ok: true, text: `${plan.target}: изменено артикулов — ${plan.changes.length}. Было и стало записано в историю.` });
        }
        sheetOk = plan.sheetDone = true;
      } catch (e) {
        results.push({ ok: false, text: plan.target + ': ' + (e.message || e) });
        this.journal.add('failed', 'Запись характеристик', { error: String(e.message || e), plan: plan.raw || plan.changes });
      }
    }
    if (sheetOk && plan.mode !== 'update') {
      for (const f of plan.folders) {
        if (f.done) continue;
        const chosen = (opts && opts.parents && opts.parents[f.tm + '|' + f.collection]) || f.parent;
        if (f.state === 'no_root') { results.push({ ok: null, text: 'Папки не создавал: в Настройках не указана папка каталога на сети.' }); continue; }
        if (f.state === 'unreachable') {
          results.push({ ok: false, text: `Папки не создал: сетевая папка недоступна (${f.root}).` });
          this.journal.add('failed', 'Сетевая папка недоступна', { root: f.root }); plan.foldersFailed = true; continue;
        }
        if (!chosen) { results.push({ ok: null, text: `Папки для ${f.collection} не создавал: не выбрано, в какую папку класть.` }); continue; }
        try {
          const r = folders.ensureCollection(f.root, chosen, f.collection);
          folders.reset(); // появились новые папки — указатель перечитается
          f.done = true;
          results.push({ ok: true, text: r.created.length ? `Папки: создано ${r.created.length} — ${r.base}` + (r.existed.length ? ` (уже было: ${r.existed.length})` : '') : `Папки уже были: ${r.base}`, open: r.base });
        } catch (e) {
          results.push({ ok: false, text: 'Папки: ' + (e.message || e) }); plan.foldersFailed = true;
          this.journal.add('failed', 'Создание папок', { error: String(e.message || e), folder: f });
        }
      }
    }
    const failed = results.some((r) => r.ok === false);
    plan.status = failed ? 'failed' : 'done';
    let tail = '';
    if (sheetOk) {
      if (plan.mode !== 'folders') this.lastArticles = plan.mode === 'add' ? plan.raw.map((p) => p.article) : plan.changes.map((c) => c.article);
      if (plan.mode === 'add') {
        const empty = [...new Set(plan.products.flatMap((p) => p.empty))];
        if (empty.length) tail = `\n\nЕщё не заполнено: ${empty.join(', ')}. Когда будут данные — просто напишите их, например «PEI 4, R10», я внесу в ${this.lastArticles.join(', ')}.`;
      }
    }
    const head = failed ? 'Сделано не всё. Что не получилось — записал в журнал разработчику. Исправьте причину и нажмите «Повторить» — уже сделанное не повторится.' : 'Готово.';
    return [this.msg(head + tail, { results, kind: failed ? 'bad' : 'ok', planUpdate: { id: planId, status: plan.status } })];
  }
}

const TWINS = [
  { name: 'Denver', base: 'Kassel', market: 'Польша' },
  { name: 'Lyon', base: 'Kronewald', market: 'Польша' },
  { name: 'Domingo', base: 'Kassel', market: 'Польша', old: true },
];

const HELP = [
  'Что я умею сейчас:',
  '• Создать только папки коллекции (без артикула):\n  «создай папку коллекции Fjord Rock»',
  '• Добавить коллекцию или артикул:\n  «Добавь коллекцию Fjord Rock, матовый рельефный керамогранит 600х600, толщина 8 мм, цвет серый, артикул FJ2580»',
  '• Дополнить или изменить данные:\n  «для FJ2580 PEI 4, R10» или сразу после добавления просто «PEI 4, R10, для пола»',
  '• Показать: «что есть по 89192», «покажи картинку 89192», «покажи визуализации по Alpina Wood»',
  '• Файлы: перетащите в чат файл выпуска плитки — проверю, нет ли новых артикулов; файл упаковочных данных — сверю и обновлю упаковку. К файлу можно дописать, что сделать.',
  '• Картинки: перетащите в чат и подпишите «фейсы в Kassel», «рендеры в Kassel» или «живые фото в Kassel» — скопирую в нужную папку коллекции',
  '• Записать задачу:\n  «задача: отправить файл технологу #плитка»',
  'Перед любым изменением я показываю план. Без кнопки «Выполнить» ничего не меняется. Всё, что не понял или не смог, попадает в журнал разработчику.',
].join('\n\n');

module.exports = { TileChat, HELP };
