// Хранилище: настройки (в папке пользователя) и данные (в выбранной папке данных).
'use strict';
const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

const DEFAULTS = {
  dataDir: '',          // пусто = папка программы у пользователя
  source: 'excel',      // где характеристики: excel | google
  sheetPath: '',        // файл характеристик
  gsUrl: '',            // адрес веб-приложения Google Таблицы
  gsToken: '',          // ключ, которым программа подписывает запросы к таблице
  catalogRoot: '',      // корень каталога на сети
  brandFolders: {},     // ТМ -> папка бренда
  geminiModel: 'gemini-3.5-flash-lite',
  geminiKey: '',        // хранится зашифрованным
  theme: 'dark-warm',   // оформление
  colors: {},           // цвета, изменённые вручную
};

class Store {
  /** crypt: { encrypt(text)->string, decrypt(string)->text } — шифрование ключа (даёт оболочка) */
  constructor(userDir, crypt) {
    this.userDir = userDir;
    this.crypt = crypt || { encrypt: (s) => s, decrypt: (s) => s };
    this.cfgFile = path.join(userDir, 'config.json');
    this.cfg = Object.assign({}, DEFAULTS, readJson(this.cfgFile, {}));
  }
  get dataDir() {
    const d = this.cfg.dataDir || path.join(this.userDir, 'data');
    fs.mkdirSync(d, { recursive: true });
    return d;
  }
  file(name) { return path.join(this.dataDir, name); }
  read(name, fallback) { return readJson(this.file(name), fallback); }
  write(name, data) { writeJson(this.file(name), data); }

  get(key) { return this.cfg[key]; }
  set(patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULTS)) continue;
      if (k === 'geminiKey') { if (v) this.cfg.geminiKey = this.crypt.encrypt(String(v).trim()); continue; }
      this.cfg[k] = typeof v === 'string' ? v.trim() : v;
    }
    writeJson(this.cfgFile, this.cfg);
  }
  clearKey() { this.cfg.geminiKey = ''; writeJson(this.cfgFile, this.cfg); }
  get geminiKey() {
    if (!this.cfg.geminiKey) return '';
    try { return this.crypt.decrypt(this.cfg.geminiKey); } catch { return ''; }
  }
  /** Настройки для экрана: ключ не отдаём, только хвост */
  publicSettings() {
    const key = this.geminiKey;
    const s = Object.assign({}, this.cfg);
    delete s.geminiKey;
    s.geminiKeyTail = key ? key.slice(-4) : '';
    s.dataDirActual = this.dataDir;
    return s;
  }
}
module.exports = { Store, readJson, writeJson };
