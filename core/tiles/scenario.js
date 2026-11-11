// Разговор про плитку: понять сообщение -> уточнить -> показать план -> выполнить по кнопке -> проверить.
// ИИ только понимает текст. Файлы и папки меняют обычные функции, и только после «Выполнить».
'use strict';
const sheet = require('./sheet');
const source = require('./source');
const folders = require('./folders');
const path = require('path');
const { understand } = require('./parse');

const ORDER = ['article', 'tm', 'collection', 'decor', 'purpose', 'usage', 'type', 'format', 'thickness', 'rect', 'color', 'surface', 'relief', 'frost', 'design', 'pei', 'ptv', 'r', 'ean', 'status', 'year', 'comment'];
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

  async handle(text) {
    text = String(text || '').trim();
    if (!text) return [];
    try {
      if (/^(помощь|помоги|что ты умеешь\??|help|\?)$/iu.test(text)) return [this.msg(HELP)];
      if (this.awaiting) {
        const used = this.applyAnswer(text);
        if (used) return await this.advance();
        if (/^(отмена|отмени|стоп|не надо)$/iu.test(text)) { this.awaiting = null; this.draft = null; return [this.msg('Отменил, ничего не менялось.')]; }
        if (this.awaiting.key === 'article' && text.split(/\s+/).length <= 3) return [this.msg('Это не похоже на артикул: он пишется без пробелов и с цифрами, например FJ2580. Напишите артикул или выберите «без артикула».', { options: this.awaiting.options || [] })];
        if (text.split(/\s+/).length <= 3) return [this.msg('Не нашёл такого варианта. Выберите кнопкой ниже или напишите «отмена».', { options: this.awaiting.options || [] })];
        this.awaiting = null; this.draft = null; // человек написал другое — начинаем заново
      }
      if (/^(привет\p{L}*|здравствуй\p{L}*|добр\p{L}+ (день|утро|вечер)|доброго дня|в[іи]таю|хай|hello|hi)[\s!.,)]*$/iu.test(text)) return [this.msg('Здравствуйте! Напишите, что сделать: добавить артикул или коллекцию, создать папки, дополнить данные, показать, что есть по артикулу, или записать задачу. Примеры — по слову «помощь».')];
      if (/^(спасибо|благодарю|дякую|спс|ок|окей|хорошо|понял|ясно|добре|зрозум[іи]ло)[\s!.,)]*$/iu.test(text)) return [this.msg('Пожалуйста. Если что-то нужно — пишите.')];
      if (!source.configured(this.store)) return [this.msg('Сначала укажите в Настройках, где лежат характеристики: Excel-файл или Google Таблица.', { kind: 'warn' })];
      const model = await source.load(this.store);
      let u; let note = '';
      const ai = this.ai && this.ai.ready() ? (s, t) => this.ai.json(s, t) : null;
      try { u = await understand(text, model, ai); } catch (e) {
        this.journal.add('error', 'ИИ не ответил, сообщение разобрано скриптом', { text, error: String(e.message || e) });
        u = await understand(text, model, null); note = 'ИИ сейчас не ответил, разобрал сообщение скриптом. ';
      }
      if (u.intent === 'task') {
        const t = this.tasks.add(u.task || text);
        return [this.msg(`Записал в задачи: «${t.text}»`, { refresh: 'tasks' })];
      }
      // «ON099» или «что по ON099?» без новых значений — это вопрос, а не правка
      const bare = (p) => Object.keys(p).every((k) => k === 'article' || k === 'collection');
      if (u.intent === 'update' && u.products.length && u.products.every((p) => p.article && bare(p))) u.intent = 'info';
      if (u.intent === 'info') return this.info(model, u.products, text);
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
    return [this.msg((say || 'Эту команду я пока не умею выполнять.') + ' Записал в журнал разработчику — её добавят в обновлении.\n\nСейчас умею: добавить коллекцию или артикул, создать папки коллекции, дополнить данные артикула, показать, что есть по артикулу или коллекции, записать задачу. Напишите «помощь» для примеров.')];
  }

  applyAnswer(text) {
    const a = this.awaiting; const low = text.toLowerCase();
    let value = null;
    if (a.options && a.options.length) value = a.options.find((o) => o.toLowerCase() === low) || null;
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
    for (const p of this.draft.products) if (a.all || p === a.product) { p[a.key] = value; if (value === '') (p._skipped = p._skipped || {})[a.key] = true; }
    this.awaiting = null;
    return true;
  }
  ask(text, key, product, opts) {
    this.awaiting = Object.assign({ key, product }, opts || {});
    return [this.msg((this.draft.note || '') + text, { options: this.awaiting.options || [] })];
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
          const dir = this.whereFolder(known.name);
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
      if (!p.tm && known) { const tm = Object.entries(known.tm).sort((a, b) => b[1] - a[1])[0]; if (tm) { p.tm = tm[0]; (p._auto = p._auto || {}).tm = 'как у коллекции'; } }
      if (!p.tm) return this.ask(`Какой бренд (ТМ) у коллекции ${p.collection}? От него зависит папка на сети.`, 'tm', p, { options: model.vocab.tm || [], all: true });
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
      if (!p.year) { p.year = String(new Date().getFullYear()); p._auto.year = 'текущий год'; }
    }
    // план
    const warnings = [];
    for (const p of d.products) {
      if (p.format && !(model.vocab.format || []).includes(p.format)) warnings.push(`Формат ${p.format} — новый, такого в характеристиках ещё нет.`);
      if (p.format && p.type && !p.rect) warnings.push(`Ректифікат для ${p.format} не знаю — таких ещё не было. Останется пустым.`);
    }
    const plan = {
      id: uid(), mode: 'add', status: 'pending', warnings: [...new Set(warnings)],
      products: d.products.map((p) => this.view(model, p)),
      raw: d.products.map((p) => { const c = {}; for (const k of ORDER) if (p[k]) c[k] = p[k]; return c; }),
      target: source.title(this.store),
      folders: this.folderPlan(d.products),
    };
    this.plans.set(plan.id, plan); this.draft = null; this.awaiting = null;
    const n = plan.products.length;
    return [this.msg((d.note || '') + (n === 1 ? `Понял. Вот что сделаю для ${plan.raw[0].article}:` : `Понял, артикулов: ${n}. Вот что сделаю:`), { plan })];
  }

  /** Где лежит папка коллекции (если каталог доступен) */
  whereFolder(collection) {
    const root = this.store.get('catalogRoot'); const tops = folders.brands(root);
    if (!root || !tops) return null;
    const ex = folders.findCollection(root, tops, safeName(collection));
    return ex ? path.join(root, ex.parent, ex.name) : '';
  }

  /** Ответ на вопрос: что есть по артикулу или коллекции. Ничего не меняет. */
  info(model, products, text) {
    const out = [];
    for (const p of products) {
      if (p.article) {
        const rec = model.byArticle.get(p.article.toLowerCase());
        if (!rec) {
          const head = p.article.toLowerCase().slice(0, 3);
          const near = model.rows.filter((r) => r.article.toLowerCase().startsWith(head)).slice(0, 8).map((r) => r.article);
          out.push(this.msg(`Артикула ${p.article} в характеристиках нет.` + (near.length ? ` Похожие: ${near.join(', ')}.` : '')));
          continue;
        }
        const rows = []; const empty = [];
        for (const k of ORDER.concat(['colorGroup'])) {
          if (k === 'article' || !model.cols[k]) continue;
          if (rec[k]) rows.push({ label: this.label(model, k), value: rec[k] }); else if (WANTED.includes(k)) empty.push(this.label(model, k));
        }
        const dir = rec.collection ? this.whereFolder(rec.collection) : null;
        out.push(this.msg(`Вот что есть по ${rec.article}:`, { card: { title: `${rec.article} · строка ${rec.row}`, rows, note: empty.length ? 'Не заполнено: ' + empty.join(', ') : 'Все основные поля заполнены.', folder: dir === null ? '' : (dir || 'Папки коллекции в каталоге нет.'), open: dir || '' } }));
      } else if (p.collection) {
        const key = sheet.norm(p.collection);
        const list = model.rows.filter((r) => sheet.norm(r.collection) === key);
        const dir = this.whereFolder(p.collection);
        if (!list.length) { out.push(this.msg(`Коллекции ${p.collection} в характеристиках нет.` + (dir ? ` Но папка в каталоге есть: ${dir}` : ''), dir ? { card: { title: p.collection, rows: [], note: '', folder: dir, open: dir } } : {})); continue; }
        const rows = list.slice(0, 60).map((r) => ({ label: r.article, value: [r.color, r.format, r.surface, r.decor, r.status && !/^актив/i.test(r.status) ? r.status : ''].filter(Boolean).join(' · ') }));
        out.push(this.msg(`Коллекция ${list[0].collection}: артикулов — ${list.length}.`, { card: { title: `${list[0].collection} · ${[...new Set(list.map((r) => r.tm))].join(', ')}`, rows, note: list.length > 60 ? `Показаны первые 60 из ${list.length}.` : '', folder: dir === null ? '' : (dir || 'Папки коллекции в каталоге нет.'), open: dir || '' } }));
      }
    }
    return out.length ? out : this.unknown(text, 'Не понял, про какой артикул или коллекцию вопрос.');
  }

  /** Только папки коллекции, без строки в характеристиках */
  planFolders(model, d) {
    const p = d.products.find((x) => x.collection) || d.products[0];
    if (!p.collection) return this.ask('Как называется коллекция?', 'collection', p, { free: true, all: true });
    const known = model.collections.get(sheet.norm(p.collection));
    if (known) { p.collection = known.name; if (!p.tm) { const tm = Object.entries(known.tm).sort((a, b) => b[1] - a[1])[0]; if (tm) p.tm = tm[0]; } }
    const fp = this.folderPlan([p]);
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

  folderPlan(products) {
    const root = this.store.get('catalogRoot');
    const groups = new Map();
    for (const p of products) groups.set(p.tm + '|' + p.collection, { tm: p.tm, status: p.status, collection: safeName(p.collection) });
    const tops = folders.brands(root);
    return [...groups.values()].map((g) => {
      const f = { tm: g.tm, collection: g.collection, root, subs: folders.SUBDIRS, state: 'ready', parent: null, parents: tops || [], why: '' };
      if (!root) f.state = 'no_root';
      else if (!tops) f.state = 'unreachable';
      else {
        const ex = folders.findCollection(root, tops, g.collection);
        if (ex) { f.parent = ex.parent; f.collection = ex.name; f.why = 'папка коллекции уже есть'; f.exists = true; f.missing = folders.missingSubs(root, ex.parent, ex.name); } else {
          const d = folders.defaultParent(tops, g, new Date().getFullYear());
          if (d) { f.parent = d.parent; f.why = d.why; } else f.state = 'need_parent';
        }
      }
      return f;
    });
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
    let sheetOk = plan.sheetDone === true || plan.mode === 'folders';
    if (!sheetOk) {
      try {
        if (plan.mode === 'add') {
          const r = await source.addRows(this.store, plan.raw, backupDir);
          results.push({ ok: true, text: `${plan.target}: добавлено строк — ${r.rows.length} (строки ${r.rows.join(', ')}). Проверено повторным чтением.`, note: 'Копия до изменения: ' + r.backup });
        } else {
          const r = await source.updateRows(this.store, plan.changes, backupDir);
          results.push({ ok: true, text: `${plan.target}: изменено артикулов — ${plan.changes.length}. Проверено повторным чтением.`, note: 'Копия до изменения: ' + r.backup });
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

const HELP = [
  'Что я умею сейчас:',
  '• Создать только папки коллекции (без артикула):\n  «создай папку коллекции Fjord Rock»',
  '• Добавить коллекцию или артикул:\n  «Добавь коллекцию Fjord Rock, матовый рельефный керамогранит 600х600, толщина 8 мм, цвет серый, артикул FJ2580»',
  '• Дополнить или изменить данные:\n  «для FJ2580 PEI 4, R10» или сразу после добавления просто «PEI 4, R10, для пола»',
  '• Записать задачу:\n  «задача: отправить файл технологу #плитка»',
  'Перед любым изменением я показываю план. Без кнопки «Выполнить» ничего не меняется. Всё, что не понял или не смог, попадает в журнал разработчику.',
].join('\n\n');

module.exports = { TileChat, HELP };
