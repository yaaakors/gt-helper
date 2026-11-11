// Экран программы. Только показывает и передаёт команды — вся работа в модулях (core).
'use strict';
const $ = (s, root) => (root || document).querySelector(s);
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'style') n.style.cssText = v; else if (k === 'value') n.value = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
}
const dmy = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`; };
const hm = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// рамка фокуса — только при работе клавиатурой
addEventListener('keydown', (e) => { if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) document.body.classList.add('kbd'); });
addEventListener('mousedown', () => document.body.classList.remove('kbd'));

// ---------- разделы ----------
const views = { chat: () => {}, tasks: renderTasks, report: renderReport, journal: renderJournal, settings: renderSettings };
function show(name) {
  for (const b of document.querySelectorAll('#nav button')) b.classList.toggle('on', b.dataset.view === name);
  $('#section').textContent = $(`#nav button[data-view=${name}]`).dataset.label;
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('on', v.id === 'view-' + name);
  views[name]();
  if (name === 'chat') $('#chat-input').focus();
  if (name === 'tasks') $('#task-input').focus();
}
$('#nav').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.view); });

// ---------- чат ----------
const chatBox = $('#chat');
const planNodes = new Map();
function scrollChat() { chatBox.scrollTop = chatBox.scrollHeight; }

function planCard(plan) {
  const card = el('div', { class: 'card plan' });
  const choice = {}; const pick = {}; // выбор папки: куда класть коллекцию
  const draw = () => {
    card.textContent = '';
    if (plan.mode !== 'update') {
      if (plan.products.length) {
      const part = el('div', { class: 'part' }, el('h3', { text: (plan.target || 'Файл характеристик') + ' — добавить' }));
      for (const p of plan.products) {
        const kv = el('dl', { class: 'kv' });
        for (const r of p.rows) kv.append(el('dt', { text: r.label }), el('dd', {}, r.value, r.auto && el('span', { class: 'auto', text: r.auto })));
        part.append(kv);
        if (p.empty.length) part.append(el('div', { class: 'note', text: 'Останется пустым: ' + p.empty.join(', ') }));
      }
      card.append(part);
      }
      for (const f of plan.folders) {
        const part2 = el('div', { class: 'part' }, el('h3', { text: 'Папки на сети — ' + (f.exists ? (f.missing.length ? 'досоздать подпапки' : 'уже есть') : 'создать') }));
        const key = f.tm + '|' + f.collection; const parent = choice[key] || f.parent;
        if (f.state === 'no_root') part2.append(el('div', { class: 'warnline', text: 'Папка каталога не указана в Настройках — папки создавать не буду.' }));
        else if (f.state === 'unreachable') part2.append(el('div', { class: 'warnline', text: 'Сетевая папка сейчас недоступна: ' + f.root }));
        else {
          const live = plan.status === 'pending';
          part2.append(el('div', { class: 'path', text: `${f.root}\\${parent || '…'}\\${f.collection}` }),
            el('div', { class: 'note' }, (f.exists ? (f.missing.length ? 'не хватает: ' + f.missing.join(', ') : 'папка коллекции уже существует, все подпапки на месте — ничего создавать не буду') : 'и внутри: ' + f.subs.join(', ') + (f.why && !choice[key] ? ` · ${f.why}` : '')),
              live && parent && !pick[key] && !f.exists && el('button', { class: 'link', text: 'Другая папка', onclick: () => { pick[key] = true; draw(); } })));
          if (!parent || pick[key]) {
            if (!parent) part2.append(el('div', { class: 'note', text: 'Не знаю, в какую папку положить. Выберите:' }));
            const chips = el('div', { class: 'chips' });
            for (const b of f.parents) chips.append(el('button', { class: 'chip' + (parent === b ? ' on' : ''), text: b, disabled: !live, onclick: () => { choice[key] = b; draw(); } }));
            part2.append(chips);
          }
        }
        card.append(part2);
      }
    } else {
      const part = el('div', { class: 'part' }, el('h3', { text: (plan.target || 'Файл характеристик') + ' — изменить' }));
      for (const v of plan.view) {
        part.append(el('div', { class: 'note', text: `${v.article} · ${v.collection}` }));
        const kv = el('dl', { class: 'kv' });
        for (const r of v.rows) kv.append(el('dt', { text: r.label }), el('dd', {}, r.from && el('span', { class: 'from', text: r.from }), r.value));
        part.append(kv);
      }
      card.append(part);
    }
    for (const w of plan.warnings || []) card.append(el('div', { class: 'warnline', text: w }));
    const actions = el('div', { class: 'actions' });
    if (plan.status === 'pending' || plan.status === 'failed') {
      const run = el('button', { class: 'btn primary act', text: plan.status === 'failed' ? 'Повторить' : 'Выполнить', onclick: async () => {
        run.disabled = true; run.textContent = 'Выполняю…';
        try { addMessages(await api.chat.execute(plan.id, { parents: choice })); } catch (e) { addMessages([{ from: 'bot', time: new Date().toISOString(), text: 'Ошибка: ' + e.message, kind: 'bad' }]); draw(); }
      } });
      actions.append(run);
      if (plan.status === 'pending') actions.append(el('button', { class: 'link', text: 'Отмена', onclick: async () => addMessages(await api.chat.cancel(plan.id)) }));
    } else {
      const map = { done: ['ok', 'выполнено'], cancelled: ['warn', 'отменён'], expired: ['warn', 'не выполнен — программа была закрыта'] };
      const [cls, text] = map[plan.status] || ['warn', plan.status];
      actions.append(el('span', { class: 'status ' + cls, text }));
    }
    card.append(actions);
  };
  draw();
  planNodes.set(plan.id, { plan, draw });
  return card;
}

function messageNode(m) {
  if (m.from === 'user') return el('div', { class: 'm user', text: m.text });
  const node = el('div', { class: 'm bot' });
  if (m.text) node.append(el('div', { class: 'text', text: m.text }));
  if (m.options && m.options.length) {
    const box = el('div', { class: 'options' });
    for (const o of m.options) box.append(el('button', { class: 'btn', text: o, onclick: () => { box.querySelectorAll('button').forEach((b) => (b.disabled = true)); send(o); } }));
    node.append(box);
  }
  if (m.plan) node.append(planCard(m.plan));
  if (m.card) {
    const c = m.card; const box = el('div', { class: 'card plan' }, el('h3', { text: c.title }));
    if (c.rows.length) { const kv = el('dl', { class: 'kv' }); for (const r of c.rows) kv.append(el('dt', { text: r.label }), el('dd', { text: r.value })); box.append(kv); }
    if (c.note) box.append(el('div', { class: 'note', text: c.note }));
    if (c.folder) box.append(el('div', { class: 'note' }, el('span', { class: 'path', text: c.folder }), c.open && el('button', { class: 'link', text: 'Открыть папку', onclick: () => api.open(c.open) })));
    node.append(box);
  }
  if (m.results) {
    const box = el('div', { class: 'card results' });
    for (const r of m.results) {
      const cls = r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'skip';
      box.append(el('div', { class: 'res ' + cls }, el('span', { class: 'mark', text: r.ok === true ? '✓' : r.ok === false ? '✕' : '–' }),
        el('span', {}, r.text, r.open && el('button', { class: 'link', text: 'Открыть папку', onclick: () => api.open(r.open) })), r.note && el('small', { text: r.note })));
    }
    node.append(box);
  }
  if (m.id) {
    const foot = el('div', { class: 'foot' }, el('span', { text: hm(m.time) }));
    const wrong = el('button', { class: 'link', text: 'Не так?', title: 'Сообщить разработчику, что ответ неправильный', onclick: () => {
      const input = el('input', { type: 'text', class: 'grow', placeholder: 'Что ожидали? (можно не писать)' });
      const form = el('form', { class: 'fb', onsubmit: async (e) => { e.preventDefault(); await api.chat.feedback(m.id, input.value.trim()); form.replaceWith(el('span', { class: 'status ok', text: 'Записал в журнал разработчику' })); } },
        input, el('button', { class: 'btn', type: 'submit', text: 'Отправить' }));
      wrong.replaceWith(form); input.focus();
    } });
    foot.append(wrong); node.append(foot);
  }
  return node;
}
function addMessages(list) {
  $('.welcome', chatBox)?.remove();
  for (const m of list) {
    if (m.planUpdate && planNodes.has(m.planUpdate.id)) { const p = planNodes.get(m.planUpdate.id); p.plan.status = m.planUpdate.status; p.draw(); }
    chatBox.append(messageNode(m));
    if (m.refresh === 'tasks') countTasks();
  }
  scrollChat();
}
let busy = false;
async function send(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true; $('#chat-send').disabled = true;
  $('.welcome', chatBox)?.remove();
  chatBox.querySelectorAll('.options button').forEach((b) => (b.disabled = true));
  const mine = messageNode({ from: 'user', text }); const wait = el('div', { class: 'm bot typing', text: 'Думаю…' });
  chatBox.append(mine, wait); scrollChat();
  try { const res = await api.chat.send(text); addMessages(res.slice(1)); }
  catch (e) { addMessages([{ from: 'bot', time: new Date().toISOString(), text: 'Ошибка: ' + e.message + '\nЗаписал в журнал разработчику.' }]); }
  finally { wait.remove(); busy = false; $('#chat-send').disabled = false; scrollChat(); }
}
const input = $('#chat-input');
function grow() { input.style.height = 'auto'; input.style.height = Math.min(160, input.scrollHeight + 2) + 'px'; }
input.addEventListener('input', grow);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#composer').addEventListener('submit', (e) => { e.preventDefault(); const t = input.value; if (!t.trim() || busy) return; input.value = ''; grow(); send(t); });
$('#chat-help').addEventListener('click', () => send('помощь'));
$('#chat-clear').addEventListener('click', async () => { await api.chat.clear(); chatBox.textContent = ''; planNodes.clear(); welcome(false); });

function welcome(firstRun) {
  const w = el('div', { class: 'welcome card' });
  if (firstRun) {
    w.append(el('div', { class: 'text', text: 'Здравствуйте! Чтобы начать, укажите в Настройках:' }),
      el('ol', {}, el('li', { text: 'файл характеристик (Excel);' }), el('li', { text: 'папку каталога на сети — где создавать папки коллекций;' }), el('li', { text: 'по желанию — ключ Gemini, чтобы лучше понимать свободный текст.' })),
      el('button', { class: 'btn primary act', text: 'Открыть настройки', onclick: () => show('settings') }));
  } else {
    w.append(el('div', { class: 'text', text: 'Напишите, что сделать. Например:\n«Добавь коллекцию Fjord Rock, матовый рельефный керамогранит 600х600, толщина 8 мм, цвет серый, артикул FJ2580»\n\nПеред любым изменением покажу план — без кнопки «Выполнить» ничего не меняется.' }));
  }
  chatBox.append(w);
}

// ---------- задачи ----------
let taskTag = '';
let doneOpen = false;
function taskText(text) {
  const span = el('span', { class: 't' });
  let last = 0;
  for (const m of text.matchAll(/#([\p{L}\p{N}_-]+)/gu)) { span.append(text.slice(last, m.index), el('span', { class: 'tag', text: m[0] })); last = m.index + m[0].length; }
  span.append(text.slice(last));
  return span;
}
let dragId = null;
let activeIds = [];
const clearMarks = () => document.querySelectorAll('.drop-before, .drop-after, .over').forEach((n) => n.classList.remove('drop-before', 'drop-after', 'over'));
function taskRow(t, n) {
  const row = el('div', { class: 'item task' + (t.done ? ' done' : ''), draggable: 'true' });
  const text = taskText(t.text);
  text.addEventListener('dblclick', () => {
    const inp = el('input', { type: 'text', value: t.text });
    const save = async () => { const v = inp.value.trim(); if (v && v !== t.text) await api.tasks.edit(t.id, v); renderTasks(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') renderTasks(); });
    inp.addEventListener('blur', save);
    row.draggable = false; text.replaceWith(inp); inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
  });
  text.title = 'Перетащите, чтобы изменить порядок. Двойной щелчок — изменить текст';
  const del = el('button', { class: 'link danger x', text: 'Удалить', onclick: () => {
    del.replaceWith(el('span', {}, el('button', { class: 'link danger', text: 'Да, удалить', onclick: async () => { await api.tasks.remove(t.id); renderTasks(); } }), el('button', { class: 'link', text: 'Нет', onclick: renderTasks })));
  } });
  if (t.done) row.append(el('span', { class: 'date', text: dmy(t.done) }), text, el('button', { class: 'link x', text: 'Вернуть', onclick: async () => { await api.tasks.toggle(t.id); renderTasks(); } }), del);
  else row.append(el('span', { class: 'num', text: n + '.' }), text, del);
  // перетаскивание: порядок = приоритет
  row.addEventListener('dragstart', (e) => { dragId = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); row.classList.add('drag'); document.body.classList.add('dragging'); });
  row.addEventListener('dragend', () => { dragId = null; clearMarks(); row.classList.remove('drag'); document.body.classList.remove('dragging'); });
  if (!t.done) {
    row.addEventListener('dragover', (e) => {
      if (!dragId || dragId === t.id) return;
      e.preventDefault(); e.stopPropagation();
      const r = row.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2;
      clearMarks(); row.classList.add(after ? 'drop-after' : 'drop-before');
    });
    row.addEventListener('drop', async (e) => {
      if (!dragId) return;
      e.preventDefault(); e.stopPropagation();
      const rest = activeIds.filter((x) => x !== dragId); // «после» = перед следующей по общему порядку
      const before = row.classList.contains('drop-after') ? (rest[rest.indexOf(t.id) + 1] || null) : t.id;
      const id = dragId; clearMarks();
      await api.tasks.move(id, before); renderTasks();
    });
  }
  return row;
}
async function countTasks() { const n = (await api.tasks.list()).filter((t) => !t.done).length; $('#tasks-count').textContent = n || ''; }
async function renderTasks() {
  const all = await api.tasks.list();
  const active = all.filter((t) => !t.done); const done = all.filter((t) => t.done).sort((a, b) => (a.done < b.done ? 1 : -1));
  activeIds = active.map((t) => t.id);
  $('#tasks-count').textContent = active.length || '';
  const tags = [...new Set(all.flatMap((t) => t.tags))].sort();
  if (!tags.includes(taskTag)) taskTag = '';
  const chips = $('#task-tags'); chips.textContent = '';
  if (tags.length) for (const tag of ['', ...tags]) chips.append(el('button', { class: 'chip' + (taskTag === tag ? ' on' : ''), text: tag ? '#' + tag : 'Все', onclick: () => { taskTag = tag; renderTasks(); } }));
  const f = (t) => !taskTag || t.tags.includes(taskTag);
  const list = $('#task-list'); list.textContent = '';
  const a = active.filter(f);
  if (!a.length) list.append(el('div', { class: 'empty', text: active.length ? 'С этим тегом задач в работе нет.' : 'Задач нет. Напишите первую в поле выше и нажмите Enter.' }));
  for (const t of a) list.append(taskRow(t, activeIds.indexOf(t.id) + 1));
  const d = done.filter(f);
  const zone = $('#done-zone'); zone.textContent = '';
  zone.append(el('span', { class: 'cap', text: `${doneOpen ? '▾' : '▸'} Выполненные · ${d.length}` }), el('span', { class: 'tip', text: 'перетащите сюда сделанную задачу' }));
  zone.classList.toggle('open', doneOpen);
  const dl = $('#done-list'); dl.hidden = !doneOpen; dl.textContent = '';
  if (doneOpen) { if (!d.length) dl.append(el('div', { class: 'empty', text: 'Выполненных задач пока нет.' })); for (const t of d) dl.append(taskRow(t)); }
}
{
  const zone = $('#done-zone'); const list = $('#task-list');
  zone.addEventListener('click', () => { doneOpen = !doneOpen; renderTasks(); });
  // задачу бросили на поле «Выполненные»
  zone.addEventListener('dragover', (e) => { if (!dragId || !activeIds.includes(dragId)) return; e.preventDefault(); clearMarks(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', async (e) => { if (!dragId || !activeIds.includes(dragId)) return; e.preventDefault(); const id = dragId; clearMarks(); await api.tasks.toggle(id); renderTasks(); });
  // задачу бросили на свободное место списка — в конец (выполненная при этом возвращается в работу)
  list.addEventListener('dragover', (e) => { if (!dragId) return; e.preventDefault(); clearMarks(); list.classList.add('over'); });
  list.addEventListener('dragleave', (e) => { if (e.target === list) list.classList.remove('over'); });
  list.addEventListener('drop', async (e) => { if (!dragId) return; e.preventDefault(); const id = dragId; clearMarks(); await api.tasks.move(id, null); renderTasks(); });
}
$('#task-form').addEventListener('submit', async (e) => { e.preventDefault(); const i = $('#task-input'); if (!i.value.trim()) return; await api.tasks.add(i.value); i.value = ''; renderTasks(); });

// ---------- отчёт ----------
const PERIODS = [['week', 'Эта неделя'], ['month', 'Этот месяц'], ['prev', 'Прошлый месяц'], ['all', 'Всё время']];
let period = 'week'; let reportTag = ''; let reportRows = [];
function range() {
  const now = new Date(); const to = ymd(now);
  if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return { from: ymd(d), to }; }
  if (period === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  if (period === 'prev') return { from: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
  return {};
}
const reportFilter = () => Object.assign(range(), reportTag ? { tag: reportTag } : {});
async function renderReport() {
  const seg = $('#report-period'); seg.textContent = '';
  for (const [k, label] of PERIODS) seg.append(el('button', { class: period === k ? 'on' : '', text: label, onclick: () => { period = k; renderReport(); } }));
  const tags = [...new Set((await api.tasks.list()).filter((t) => t.done).flatMap((t) => t.tags))].sort();
  if (!tags.includes(reportTag)) reportTag = '';
  const chips = $('#report-tags'); chips.textContent = '';
  if (tags.length) for (const tag of ['', ...tags]) chips.append(el('button', { class: 'chip' + (reportTag === tag ? ' on' : ''), text: tag ? '#' + tag : 'Все теги', onclick: () => { reportTag = tag; renderReport(); } }));
  reportRows = await api.tasks.report(reportFilter());
  $('#report-sum').textContent = reportRows.length ? `Выполнено задач: ${reportRows.length}` : '';
  const body = $('#report-body'); body.textContent = '';
  if (!reportRows.length) { body.append(el('div', { class: 'empty', text: 'За этот период выполненных задач нет.' })); }
  let day = '';
  for (const t of reportRows) {
    if (t.doneDay !== day) { day = t.doneDay; body.append(el('div', { class: 'day', text: dmy(t.done) })); }
    body.append(el('div', { class: 'item' }, taskText(t.text)));
  }
  $('#report-copy').disabled = $('#report-xlsx').disabled = !reportRows.length;
}
$('#report-copy').addEventListener('click', async () => {
  let day = ''; const lines = [];
  for (const t of reportRows) { if (t.doneDay !== day) { day = t.doneDay; lines.push((lines.length ? '\n' : '') + dmy(t.done)); } lines.push('— ' + t.text); }
  await api.copy(lines.join('\n')); const b = $('#report-copy'); b.textContent = 'Скопировано'; setTimeout(() => (b.textContent = 'Копировать текстом'), 1500);
});
$('#report-xlsx').addEventListener('click', () => api.tasks.exportXlsx(reportFilter()));

// ---------- журнал ----------
async function renderJournal() {
  const list = $('#journal-list'); list.textContent = '';
  const rows = await api.journal.list();
  if (!rows.length) list.append(el('div', { class: 'empty', text: 'Записей нет — значит, всё получалось.' }));
  for (const r of rows) {
    const body = el('div', { class: 't' }, r.message);
    if (r.details) body.append(el('details', {}, el('summary', { text: 'подробности' }), el('pre', { text: JSON.stringify(r.details, null, 1) })));
    list.append(el('div', { class: 'item j' }, el('span', { class: 'date', text: dmy(r.time) + ' ' + hm(r.time) }), el('span', { class: 'kind', text: r.kindLabel }), body));
  }
}
$('#idea-form').addEventListener('submit', async (e) => { e.preventDefault(); const i = $('#idea-input'); if (!i.value.trim()) return; await api.journal.add(i.value.trim()); i.value = ''; renderJournal(); });
$('#journal-open').addEventListener('click', () => api.journal.open());

// ---------- оформление ----------
function applyLook(look) {
  const r = document.documentElement;
  for (const [k, v] of Object.entries(look.colors)) r.style.setProperty('--' + k, v);
  r.classList.remove('boot');
}

// ---------- настройки ----------
let updateState = { state: 'idle' }; let appVersion = '';
function flashSaved() { const s = $('#saved'); s.hidden = false; clearTimeout(flashSaved.t); flashSaved.t = setTimeout(() => (s.hidden = true), 1500); }
async function renderSettings(data) {
  const { settings: s, status: st, look } = data || await api.settings.get();
  applyLook(look);
  const box = $('#settings'); box.textContent = '';
  const save = async (patch) => { const d = await api.settings.set(patch); flashSaved(); renderSettings(d); };
  const pathField = (key, label, state, hint, btn) => {
    const inp = el('input', { type: 'text', class: 'grow', value: s[key] || '', spellcheck: 'false' });
    inp.addEventListener('change', () => save({ [key]: inp.value }));
    return el('div', { class: 'f' }, el('label', { text: label }),
      el('div', { class: 'ctl' }, inp, el('button', { class: 'btn', text: btn || 'Выбрать…', onclick: async () => { const p = await api.settings.pick(key); if (p) save({ [key]: p }); } })),
      state && el('div', { class: 'hint ' + (state.ok ? 'ok' : 'bad'), text: (state.ok ? '✓ ' : '') + state.text }), hint && el('div', { class: 'hint', text: hint }));
  };
  // источник характеристик: Excel-файл или Google Таблица
  const src = el('div', { class: 'seg' });
  for (const [id, label] of [['excel', 'Excel-файл'], ['google', 'Google Таблица']]) src.append(el('button', { class: s.source === id ? 'on' : '', text: label, onclick: () => save({ source: id }) }));
  const tile = el('div', { class: 'group' }, el('div', { class: 'cap', text: 'Плитка' }), el('div', { class: 'f' }, el('label', { text: 'Характеристики' }), el('div', {}, src)));
  if (s.source === 'google') {
    const url = el('input', { type: 'text', class: 'grow', value: s.gsUrl || '', spellcheck: 'false', placeholder: 'https://script.google.com/macros/s/…/exec' });
    url.addEventListener('change', () => save({ gsUrl: url.value }));
    const copyBtn = el('button', { class: 'btn', text: 'Скопировать скрипт', onclick: async () => { await api.gsScript(); copyBtn.textContent = 'Скопировано'; setTimeout(() => (copyBtn.textContent = 'Скопировать скрипт'), 1500); } });
    tile.append(el('div', { class: 'f' }, el('label', { text: 'Подключение' }), el('div', { class: 'ctl' }, copyBtn),
      el('ol', { class: 'hint steps' },
        el('li', { text: 'Нажмите «Скопировать скрипт».' }),
        el('li', { text: 'В Google Таблице: «Расширения» → «Apps Script». Удалите всё в окне, вставьте скрипт (Ctrl+V), сохраните (значок дискеты).' }),
        el('li', { text: 'Справа вверху: «Начать развертывание» → «Новое развертывание». Тип (шестерёнка) — «Веб-приложение». «Запуск от имени» — «От моего имени», «У кого есть доступ» — «Все». Нажмите «Развернуть» и разрешите доступ к таблице.' }),
        el('li', { text: 'Скопируйте «URL веб-приложения» и вставьте в поле ниже.' }))),
      el('div', { class: 'f' }, el('label', { text: 'Адрес веб-приложения' }), el('div', { class: 'ctl' }, url),
        el('div', { class: 'hint ' + (st.sheet.ok ? 'ok' : 'bad'), text: (st.sheet.ok ? '✓ ' : '') + st.sheet.text }),
        el('div', { class: 'hint', text: 'Адрес работает только вместе с ключом, который зашит в скрипт, — не пересылайте скрипт другим. Перед каждым изменением программа сохраняет снимок таблицы в папку данных (backups); у самой таблицы есть ещё «История версий».' })));
  } else {
    tile.append(pathField('sheetPath', 'Файл характеристик', st.sheet, 'Перед каждым изменением программа сохраняет копию файла в папку данных (backups).'));
  }
  tile.append(pathField('catalogRoot', 'Папка каталога', st.root, 'Корень на сети, где лежат папки коллекций. Можно вставить путь вида \\\\сервер\\папка.'));
  box.append(tile);

  // ИИ
  const key = el('input', { type: 'password', class: 'grow', placeholder: s.geminiKeyTail ? 'сохранён, заканчивается на …' + s.geminiKeyTail : 'вставьте ключ из Google AI Studio', autocomplete: 'off' });
  const aiHint = el('div', { class: 'hint ' + (st.ai.ok ? 'ok' : ''), text: (st.ai.ok ? '✓ ' : '') + st.ai.text });
  const models = el('div', { class: 'hint chips' });
  const model = el('input', { type: 'text', class: 'grow', value: s.geminiModel, spellcheck: 'false' });
  model.addEventListener('change', () => save({ geminiModel: model.value }));
  key.addEventListener('change', () => { if (key.value.trim()) save({ geminiKey: key.value }); });
  const check = el('button', { class: 'btn', text: 'Проверить', onclick: async () => {
    check.disabled = true; aiHint.className = 'hint'; aiHint.textContent = 'Проверяю…';
    const r = await api.settings.checkAi(key.value);
    check.disabled = false; aiHint.className = 'hint ' + (r.ok ? 'ok' : 'bad'); aiHint.textContent = (r.ok ? '✓ ' : '') + r.text;
    models.textContent = '';
    for (const m of r.models || []) models.append(el('button', { class: 'chip', text: m, onclick: () => save({ geminiModel: m }) }));
  } });
  box.append(el('div', { class: 'group' }, el('div', { class: 'cap', text: 'ИИ (Gemini)' }),
    el('div', { class: 'f' }, el('label', { text: 'Ключ' }), el('div', { class: 'ctl' }, key, check, s.geminiKeyTail && el('button', { class: 'link danger', text: 'Убрать', onclick: async () => renderSettings(await api.settings.clearKey()) })), aiHint, models,
      el('div', { class: 'hint', text: 'Ключ хранится только на этом компьютере в зашифрованном виде. ИИ лишь разбирает текст сообщения; файлы и папки меняет сама программа и только после кнопки «Выполнить».' })),
    el('div', { class: 'f' }, el('label', { text: 'Модель' }), el('div', { class: 'ctl' }, model))));

  // оформление: готовые темы + свой цвет для каждого элемента
  const themesBox = el('div', { class: 'chips' });
  for (const t of look.themes) {
    const sw = el('span', { class: 'sw', text: 'Аа' }); sw.style.background = t.bg; sw.style.color = t.text; sw.style.borderColor = t.gold;
    themesBox.append(el('button', { class: 'theme' + (t.id === look.id ? ' on' : ''), onclick: () => save({ theme: t.id, colors: {} }) }, sw, t.name));
  }
  const colors = el('div', { class: 'colors' });
  const mine = Object.assign({}, s.colors || {});
  for (const e of look.elements) {
    const inp = el('input', { type: 'color', value: look.colors[e.key], 'aria-label': e.label });
    const hex = el('span', { class: 'hex', text: look.colors[e.key] });
    inp.addEventListener('input', () => { document.documentElement.style.setProperty('--' + e.key, inp.value); hex.textContent = inp.value; });
    inp.addEventListener('change', () => { mine[e.key] = inp.value; save({ colors: mine }); });
    colors.append(inp, el('span', {}, e.label, hex, look.changed.includes(e.key) && el('span', { class: 'mine', text: 'изменён' })));
  }
  box.append(el('div', { class: 'group' }, el('div', { class: 'cap', text: 'Оформление' }),
    el('div', { class: 'f' }, el('label', { text: 'Тема' }), themesBox),
    el('div', { class: 'f' }, el('label', { text: 'Цвета элементов' }), colors,
      el('div', { class: 'hint', text: 'Щёлкните по цвету, чтобы поменять. Наведение, подсказки и фон статусов подстраиваются сами.' }),
      look.changed.length ? el('div', { class: 'hint' }, el('button', { class: 'link', text: 'Вернуть цвета темы', onclick: () => save({ colors: {} }) })) : null)));

  box.append(el('div', { class: 'group' }, el('div', { class: 'cap', text: 'Данные программы' }),
    pathField('dataDir', 'Папка данных', null, 'Здесь лежат задачи, журнал разработчику, переписка и копии файла. Сейчас: ' + s.dataDirActual)));

  const u = updateState; const map = { dev: 'запущено из исходников — обновления выключены', idle: '', checking: 'проверяю…', latest: 'у вас последняя версия', available: 'доступна версия ' + u.version, downloading: `загружаю… ${u.percent || 0}%`, ready: `версия ${u.version} загружена — перезапустите для установки`, error: 'проверить не получилось: ' + (u.error || '') };
  box.append(el('div', { class: 'group' }, el('div', { class: 'cap', text: 'Обновления' }),
    el('div', { class: 'f' }, el('label', { text: 'Версия' }), el('div', { class: 'ctl' }, el('span', { style: 'padding-top:6px', text: appVersion }), el('button', { class: 'btn', text: 'Проверить обновления', disabled: u.state === 'dev', onclick: async () => { await api.update.check(); } })),
      el('div', { class: 'hint' + (u.state === 'error' ? ' bad' : ''), text: map[u.state] || '' }))));
}

// ---------- обновления ----------
function renderUpdate(u) {
  updateState = u; const box = $('#update-box'); box.textContent = '';
  box.hidden = !['available', 'downloading', 'ready'].includes(u.state);
  if (u.state === 'available') box.append(el('b', { text: 'Новая версия ' + u.version }), el('button', { text: 'Обновить', onclick: () => api.update.download() }));
  if (u.state === 'downloading') box.append(el('b', { text: 'Загружаю обновление' }), `${u.percent || 0}%`, el('div', { class: 'bar' }, el('i', { style: `width:${u.percent || 0}%` })));
  if (u.state === 'ready') box.append(el('b', { text: 'Обновление готово' }), el('button', { text: 'Перезапустить', onclick: () => api.update.install() }));
  if ($('#view-settings').classList.contains('on')) renderSettings();
}
api.update.on(renderUpdate);

// ---------- запуск ----------
(async () => {
  const info = await api.info();
  applyLook(info.look);
  appVersion = info.version; $('#version').textContent = 'версия ' + info.version;
  renderUpdate(info.update);
  const hist = await api.chat.history();
  if (hist.length) addMessages(hist); else welcome(info.firstRun);
  countTasks(); input.focus();
})();
