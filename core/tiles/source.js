// Где лежат характеристики: Excel-файл или Google Таблица. Остальной код об этом не думает.
'use strict';
const excel = require('./sheet');
const google = require('./gsheet');

const isGoogle = (store) => store.get('source') === 'google';
const gcfg = (store) => ({ url: store.get('gsUrl'), token: store.get('gsToken') });

module.exports = {
  isGoogle,
  title: (store) => (isGoogle(store) ? 'Google Таблица' : 'Файл характеристик'),
  configured: (store) => (isGoogle(store) ? !!store.get('gsUrl') : !!store.get('sheetPath')),
  load: (store, fresh) => (isGoogle(store) ? google.load(gcfg(store), fresh) : excel.load(store.get('sheetPath'))),
  addRows: (store, products, backupDir) => (isGoogle(store) ? google.addRows(gcfg(store), products, backupDir) : excel.addRows(store.get('sheetPath'), products, backupDir)),
  updateRows: (store, changes, backupDir) => (isGoogle(store) ? google.updateRows(gcfg(store), changes, backupDir) : excel.updateRows(store.get('sheetPath'), changes, backupDir)),
};
