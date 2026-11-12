// Где лежат характеристики: Excel-файл, Google Таблица или База. Остальной код об этом не думает.
'use strict';
const excel = require('./sheet');
const google = require('./gsheet');

const kind = (store) => (['google', 'db'].includes(store.get('source')) ? store.get('source') : 'excel');
const isGoogle = (store) => kind(store) === 'google';
const gcfg = (store) => ({ url: store.get('gsUrl'), token: store.get('gsToken') });

// База открывается один раз и живёт, пока работает программа
let dbi = null;
function db(store) {
  const file = store.file('gt.db');
  if (dbi && dbi.file === file) return dbi;
  if (dbi) dbi.close();
  const { Db } = require('../db/db');
  dbi = new Db(file);
  return dbi;
}

const TITLES = { excel: 'Файл характеристик', google: 'Google Таблица', db: 'База' };
module.exports = {
  kind, isGoogle, db,
  title: (store) => TITLES[kind(store)],
  configured: (store) => ({ excel: () => !!store.get('sheetPath'), google: () => !!store.get('gsUrl'), db: () => db(store).count() > 0 })[kind(store)](),
  load: async (store, fresh) => ({ excel: () => excel.load(store.get('sheetPath')), google: () => google.load(gcfg(store), fresh), db: () => db(store).model() })[kind(store)](),
  addRows: async (store, products, backupDir) => ({
    excel: () => excel.addRows(store.get('sheetPath'), products, backupDir),
    google: () => google.addRows(gcfg(store), products, backupDir),
    db: () => db(store).addRows(products, 'Вит', 'чат'),
  })[kind(store)](),
  updateRows: async (store, changes, backupDir) => ({
    excel: () => excel.updateRows(store.get('sheetPath'), changes, backupDir),
    google: () => google.updateRows(gcfg(store), changes, backupDir),
    db: () => db(store).updateRows(changes, 'Вит', 'чат'),
  })[kind(store)](),
  /** Прочитать таблицу (Google или Excel) — для переноса в базу, независимо от выбранного источника */
  loadFrom: (store, from) => (from === 'google' ? google.load(gcfg(store), true) : excel.load(store.get('sheetPath'))),
};
