// Разбор сообщения про плитку: скриптом (всегда) и через ИИ (если подключён).
// Результат один и тот же: { intent, products:[{поле: значение}], task }
'use strict';

// русское/украинское начало слова -> значение из файла характеристик
const COLOR = [
  ['светло-сер', 'світло-сірий'], ['світло-сір', 'світло-сірий'], ['темно-сер', 'темно-сірий'], ['темно-сір', 'темно-сірий'],
  ['светло-беж', 'світло-бежевий'], ['світло-беж', 'світло-бежевий'], ['темно-беж', 'темно-бежевий'],
  ['серо-беж', 'сіро-бежевий'], ['сіро-беж', 'сіро-бежевий'], ['серо-коричн', 'сіро-коричневий'], ['сіро-коричн', 'сіро-коричневий'],
  ['светло-коричн', 'світло-коричневий'], ['світло-коричн', 'світло-коричневий'],
  ['сер', 'сірий'], ['сір', 'сірий'], ['беж', 'бежевий'], ['бел', 'білий'], ['біл', 'білий'], ['черн', 'чорний'], ['чорн', 'чорний'],
  ['коричн', 'коричневий'], ['антрацит', 'антрацитовий'], ['графит', 'графітовий'], ['графіт', 'графітовий'],
  ['айвори', 'айворі'], ['айворі', 'айворі'], ['кремов', 'кремовий'], ['син', 'синій'], ['голуб', 'блакитний'], ['блакит', 'блакитний'],
  ['зелен', 'зелений'], ['оливк', 'оливковий'], ['мятн', "м'ятний"], ["м'ятн", "м'ятний"], ['розов', 'рожевий'], ['рожев', 'рожевий'],
  ['терракот', 'теракотовий'], ['теракот', 'теракотовий'], ['оранж', 'помаранчевий'], ['помаранч', 'помаранчевий'],
  ['красн', 'червоний'], ['червон', 'червоний'], ['микс', 'мікс'], ['мікс', 'мікс'], ['мокко', 'мокко'], ['бирюз', 'бірюзовий'], ['бірюз', 'бірюзовий'],
  ['песочн', 'пісочний'], ['пісочн', 'пісочний'], ['пепельн', 'попелястий'], ['попеляст', 'попелястий'], ['дымчат', 'димчастий'], ['димчаст', 'димчастий'],
  ['табач', 'тютюновий'], ['тютюн', 'тютюновий'], ['пудр', 'пудровий'], ['кобальт', 'кобальт'],
];
const DESIGN = [
  ['камен', 'камінь'], ['камн', 'камінь'], ['камін', 'камінь'], ['бетон', 'бетон'], ['мрамор', 'мармур'], ['мармур', 'мармур'],
  ['дерев', 'дерево'], ['оникс', 'онікс'], ['онікс', 'онікс'], ['террац', 'терраццо'], ['кирпич', 'цегла'], ['цегл', 'цегла'],
  ['металл', 'метал'], ['метал', 'метал'], ['моноколор', 'моноколор'], ['травертин', 'травертин'], ['мозаик', 'мозаїка'], ['мозаїк', 'мозаїка'],
];
const TM = [
  ['terragres', 'Terragres'], ['террагрес', 'Terragres'], ['golden tile', 'Goldentile'], ['goldentile', 'Goldentile'], ['голден тайл', 'Goldentile'],
  ['primavera', 'Primavera'], ['примавера', 'Primavera'], ['deseo', 'Deseo'], ['десео', 'Deseo'], ['brickstyle', 'Brickstyle'], ['брикстайл', 'Brickstyle'],
];
const W = '(?<![\\p{L}\\p{N}-])'; // начало слова (\b с кириллицей не работает)

function byStem(text, table) {
  let best = null;
  for (const [stem, value] of table) {
    const m = new RegExp(W + stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu').exec(text);
    if (m && (!best || stem.length > best.len)) best = { value, len: stem.length, at: m.index };
  }
  return best && best.value;
}

function parseLocal(text, model) {
  const t = ' ' + text.replace(/\s+/g, ' ') + ' ';
  const low = t.toLowerCase();
  const f = {};
  let m;

  // задача в планировщик
  if ((m = /^\s*(?:задач[аиу]|в план|todo|запиши(?: себе)?(?: задачу)?)\s*[:—-]?\s+(.+)$/iu.exec(text.trim()))) return { intent: 'task', task: m[1].trim(), products: [] };

  // артикулы
  const articles = [];
  if ((m = /артикул\p{L}*\s*[:№#]?\s*((?:[\p{L}\d]{4,8})(?:\s*(?:,|и|та|і)\s*[\p{L}\d]{4,8})*)/iu.exec(t))) {
    for (const a of m[1].split(/\s*(?:,|\sи\s|\sта\s|\sі\s)\s*/)) if (/\d/.test(a)) articles.push(a.trim());
  }
  // «для 46001 …» и любой код, который уже есть в характеристиках
  if (!articles.length && (m = /(?<![\p{L}])(?:для|у)\s+([\p{L}\d]{4,8})(?![\p{L}\d])/iu.exec(t)) && /\d/.test(m[1]) && !/^\d+[xXхХ]\d+$/u.test(m[1])) articles.push(m[1]);
  if (!articles.length && model) for (const x of t.matchAll(/(?<![\p{L}\d])[\p{L}\d]{4,8}(?![\p{L}\d])/gu)) {
    if (/\d/.test(x[0]) && model.byArticle.has(x[0].toLowerCase()) && !articles.includes(x[0])) articles.push(x[0]);
  }
  // без слова «артикул»: код из больших букв и цифр (FJ2580, 46П01)
  if (!articles.length) for (const x of t.matchAll(/(?<![\p{L}\d])[\p{Lu}\d]{4,8}(?![\p{L}\d+])/gu)) {
    const a = x[0];
    if (/\p{Lu}/u.test(a) && /\d/.test(a) && !/^\d+[XХ]\d+$/u.test(a) && !/^(PEI|PTV|EAN)\d*$/.test(a) && !articles.includes(a)) articles.push(a);
  }
  // коллекция: латинское название после слова «коллекция»
  if ((m = /кол+е[кц][цк]?\p{L}*\s+[«"“]?([A-Za-z][A-Za-z0-9'’&.-]*(?:\s+[A-Za-z(][A-Za-z0-9'’&.()-]*)*)/iu.exec(t))) f.collection = m[1].trim();
  // формат и толщина
  if ((m = /(?<!\d)(\d{2,4})\s*[xх×*]\s*(\d{2,4})(?:\s*[xх×*]\s*(\d{1,2}(?:[.,]\d)?))?(?!\d)/iu.exec(t))) {
    f.format = `${m[1]}х${m[2]}`; if (m[3]) f.thickness = m[3].replace(',', '.');
  }
  if ((m = /то[лв]щин\p{L}*\s*[:=]?\s*(\d{1,2}(?:[.,]\d)?)/iu.exec(t))) f.thickness = m[1].replace(',', '.');
  else if (!f.thickness && (m = /(?<![\dxх×*,.]\s?)(?<!\d)(\d{1,2}(?:[.,]\d)?)\s*мм/iu.exec(t))) f.thickness = m[1].replace(',', '.');
  // тип
  if (/керам\p{L}{0,3}гран[иі]т|(?<![\p{L}])грес/iu.test(low)) f.type = 'керамограніт';
  else if (/керам[иі]ч\p{L}+\s+плитк|кафел/iu.test(low)) f.type = 'керамічна плитка';
  // назначение
  if (/наполь|для пола|на пол(?![\p{L}])|п[іи]длог/iu.test(low)) f.purpose = 'підлога';
  else if (/настен|для стен|на стен|для ст[іи]н|(?<![\p{L}])ст[іи]на(?![\p{L}])/iu.test(low)) f.purpose = 'стіна';
  // поверхность
  if (/сахар|цукр/iu.test(low)) f.surface = 'матова, "цукрова" граніль';
  else if (/полумат|нап[іи]вмат/iu.test(low)) f.surface = 'напівматова';
  else if (/лаппат|лапат/iu.test(low)) f.surface = 'лаппатована';
  else if (/сатин/iu.test(low)) f.surface = 'сатинова';
  else if (/глянц/iu.test(low) && !/карв[иі]нг/iu.test(low)) f.surface = 'глянцева';
  else if (/матов/iu.test(low) && !/карв[иі]нг/iu.test(low)) f.surface = 'матова';
  // рельеф
  if (/не\s*рель[еє]ф|без\s+рель[еє]ф|гладк/iu.test(low)) f.relief = 'не рельєфна';
  else if (/рель[еє]ф/iu.test(low)) f.relief = 'рельєфна';
  // цвет: сначала рядом со словом «цвет», потом по всему тексту
  const near = /(?:цвет\p{L}*|кол[іи]р\p{L}*)\s*[:—-]?\s*([\p{L}'’-]+(?:\s+[\p{L}'’-]+)?)/iu.exec(t);
  const color = (near && byStem(near[1], COLOR)) || byStem(low.replace(/кол+е[кц]\p{L}*\s+\S+/giu, ' '), COLOR);
  if (color) f.color = color;
  else if (near && !/^(не|пока|позже|потом|буде|будет)/iu.test(near[1])) f.color = near[1].split(/\s+/)[0].toLowerCase(); // незнакомый цвет — спросим
  // дизайн
  const dz = /(?:дизайн\p{L}*|под|п[іи]д|имитаци\p{L}*)\s*[:—-]?\s*([\p{L}-]+)/iu.exec(t);
  const design = dz && byStem(dz[1], DESIGN); if (design) f.design = design;
  // бренд
  for (const [k, v] of TM) if (low.includes(k)) { f.tm = v; break; }
  if (model) for (const tm of model.vocab.tm || []) if (low.includes(tm.toLowerCase()) && (!f.tm || tm.length > f.tm.length)) f.tm = tm;
  // техника
  if ((m = /pei\s*[:=-]?\s*(\d)/iu.exec(t))) f.pei = m[1];
  if ((m = /(?<![\p{L}\d])R\s?(9|10\s?\+|10|11|12|13)(?![\d])/u.exec(t))) f.r = 'R' + m[1].replace(/\s/g, '');
  else if (/не\s+норму/iu.test(low)) f.r = 'не нормується';
  if ((m = /(?<!\d)(\d{13})(?!\d)/.exec(t))) f.ean = m[1];

  // название коллекции без слова «коллекция» — если такая уже есть в характеристиках
  if (!f.collection && model) {
    let best = '';
    for (const c of model.collections.values()) {
      if (c.name.length < 4 || c.name.length <= best.length) continue;
      if (new RegExp('(?<![\\p{L}\\d])' + c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\d])', 'iu').test(t)) best = c.name;
    }
    if (best) f.collection = best;
  }
  // вопрос: «что есть по ON099?», «покажи коллекцию Fjord Rock»
  const ask = /^\s*(что|шо|покажи|показать|найди|инф|данные|расскажи|есть ли|какой|какая|какие|сколько|ск[іи]льки|где|де|як[іи]й)(?![\p{L}])|\?\s*$/iu.test(text);
  const hasFields = Object.keys(f).length > 0;
  const addWord = /добав|додай|додат|создай|створи|заведи|нов(ая|ую|а|у)\s+кол/iu.test(low);
  const updWord = /обнов|онов|измен|зм[іи]н|дополн|внеси|постав|укажи|вкажи|исправ|виправ/iu.test(low);
  let intent = 'unknown';
  const known = model ? articles.filter((a) => model.byArticle.has(a.toLowerCase())) : [];
  if (articles.length) intent = known.length === articles.length && !addWord ? 'update' : 'add';
  else if (addWord && (f.collection || hasFields)) intent = 'add';
  else if (hasFields && updWord) intent = 'update';
  else if (hasFields && !f.collection && !ask) intent = 'update'; // «PEI 4, R10» — продолжение про последний артикул
  const products = articles.length ? articles.map((a) => Object.assign({ article: a }, f)) : (hasFields ? [f] : []);
  if (ask && !addWord && !updWord && (articles.length || f.collection)) intent = 'info';
  // «покажи картинку 89192», «покажи визуализации по Alpina Wood»
  const pic = /картинк|фото|изображен|зображен|текстур|фейс|(?<![\p{L}])face/iu.test(low); const rend = /в[иі]зуал[иі]зац|рендер|[иі]нтер.?[ьє]?ер/iu.test(low);
  let what = '';
  if ((pic || rend) && !addWord && !updWord && (articles.length || f.collection)) { intent = 'show'; what = rend ? 'renders' : 'photo'; }
  return { intent, products, task: '', what, explicit: addWord || updWord || articles.length > 0 };
}

const FIELD_DOC = {
  article: 'артикул (как написан, буквы не менять)', tm: 'бренд (ТМ)', collection: 'название коллекции', decor: 'название декора (латиницей, маленькими)',
  purpose: 'призначення', usage: 'застосування (через запятую)', type: 'тип', format: 'формат, вид «600х600»', thickness: 'толщина в мм, число',
  color: 'колір', surface: 'поверхня', relief: 'рельєф', design: 'тип дизайну', pei: 'PEI, число', ptv: 'PTV, вид «55/21»', r: 'R', ean: 'штрихкод EAN', comment: 'коментар',
};

function aiPrompt(model) {
  const list = (key, max = 60) => (model.vocab[key] || []).slice(0, max).join(' | ');
  return [
    'Ты разбираешь сообщения сотрудника завода керамической плитки Golden Tile. Сообщения на русском или украинском.',
    'Верни ТОЛЬКО JSON вида: {"intent": "...", "products": [{...}], "task": "", "reply": "", "what": ""}.',
    'intent: "add" — добавить новые артикулы/коллекцию (также когда просят создать только папку коллекции без артикула — тогда в products один объект с collection); "update" — дополнить или изменить данные существующих артикулов (в сообщении есть новые значения); "info" — вопрос о том, что уже есть: показать данные артикула или коллекции (в products объект с article или collection); "show" — просят показать картинку, фото, текстуру плитки или визуализации/рендеры (в products объект с article или collection; в поле what: "photo" или "renders"); "task" — записать задачу в планировщик (текст задачи в поле task); "chat" — приветствие, благодарность, вопрос о возможностях программы или общий вопрос о плитке: ответ дай в поле reply, коротко, по-русски, без жаргона; "unknown" — просьба сделать то, чего программа не умеет.',
    'Программа умеет ТОЛЬКО: добавить артикул/коллекцию в характеристики и создать папки коллекции; создать только папки коллекции; дополнить или изменить данные артикула; показать данные артикула или коллекции; записать задачу. В reply нельзя писать, что что-то сделано, будет сделано или найдено — действий ты не выполняешь и данных не видишь.',
    'products — по одному объекту на артикул. Если артикулов несколько и у них разные цвета/форматы — раздели правильно. Поля объекта (включай только то, что прямо сказано в сообщении, ничего не выдумывай):',
    ...Object.entries(FIELD_DOC).map(([k, v]) => `- ${k}: ${v}`),
    'Значения переводи на украинский и бери ТОЛЬКО из списков, если подходящее есть:',
    `tm: ${list('tm')}`, `purpose: ${list('purpose')}`, `type: ${list('type')}`, `color: ${Object.keys(model.colors).join(' | ') || list('color')}`,
    `surface: ${list('surface')}`, `relief: ${list('relief')}`, `r: ${list('r')}`,
    `design (можно несколько через запятую): ${model.designParts.join(' | ')}`,
    `usage (можно несколько через запятую): ${model.usageParts.join(' | ')}`,
    'Если значения в списке нет — верни его как написал человек. Названия коллекций и артикулы не переводить и не исправлять.',
  ].join('\n');
}

/** Разбор: ИИ (если есть) + скрипт как страховка. ai: функция (system, user) -> объект */
async function understand(text, model, ai) {
  const local = parseLocal(text, model);
  // задачу, вопрос про артикул/коллекцию и просьбу показать картинки скрипт понимает сам — ИИ не ждём
  if (!ai || ['task', 'show', 'info'].includes(local.intent)) return Object.assign(local, { via: 'script' });
  const res = await ai(aiPrompt(model), text);
  const intent = ['add', 'update', 'info', 'show', 'task', 'chat', 'unknown'].includes(res && res.intent) ? res.intent : 'unknown';
  let products = Array.isArray(res && res.products) ? res.products.filter((p) => p && typeof p === 'object') : [];
  products = products.map((p) => {
    const out = {};
    for (const k of Object.keys(FIELD_DOC)) if (p[k] !== undefined && p[k] !== null && String(p[k]).trim() !== '') out[k] = String(p[k]).trim();
    return out;
  }).filter((p) => Object.keys(p).length);
  // то, что скрипт находит надёжно (формат, артикул, толщина), сверяем
  if (products.length === 1 && local.products.length === 1) for (const k of ['format', 'thickness', 'article']) if (!products[0][k] && local.products[0][k]) products[0][k] = local.products[0][k];
  const reply = String((res && res.reply) || '').slice(0, 1500);
  // ИИ не распознал команду, а скрипт видит явную (есть глагол, артикул или вопрос про артикул) — верим скрипту
  if ((intent === 'unknown' || (intent === 'chat' && !reply)) && (local.intent === 'info' || (local.intent !== 'unknown' && local.explicit))) return Object.assign(local, { via: 'script' });
  if (local.intent === 'info' && intent === 'update') return Object.assign(local, { via: 'script' }); // вопрос — не правка
  return { intent, products, task: String((res && res.task) || ''), reply, what: (res && res.what) === 'renders' ? 'renders' : 'photo', via: 'ai' };
}
module.exports = { parseLocal, understand, TM };
