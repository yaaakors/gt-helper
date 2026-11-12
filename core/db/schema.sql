-- База данных GT Помощника. Описание простыми словами — DATA.md.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

-- Виды товаров: плитка, позже сантехника, посуда…
CREATE TABLE IF NOT EXISTS kinds (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  own INTEGER NOT NULL DEFAULT 1,           -- 1 — свой, 0 — импорт
  supplier TEXT, folder TEXT
);

-- Торговые сети (для эксклюзивов)
CREATE TABLE IF NOT EXISTS networks (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);

-- Виртуальные группы товаров: GT Basic, SlimStyle…
CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  brand_id INTEGER REFERENCES brands(id),    -- основной бренд (у артикулов одной коллекции бренды бывают разные)
  kind_id INTEGER REFERENCES kinds(id),
  network_id INTEGER REFERENCES networks(id), -- эксклюзив всей коллекции
  folder TEXT, drive_id TEXT
);

-- Справочники значений: цвета (с группой), поверхности, дизайн, применение…
CREATE TABLE IF NOT EXISTS dict (
  id INTEGER PRIMARY KEY, field TEXT NOT NULL, value TEXT NOT NULL,
  parent_id INTEGER REFERENCES dict(id),    -- для цвета — его группа
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (field, value)
);
CREATE TABLE IF NOT EXISTS dict_tr (dict_id INTEGER NOT NULL REFERENCES dict(id) ON DELETE CASCADE, lang TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY (dict_id, lang));

-- Артикулы (главный список). Упаковка и штрихкод — только первый сорт (решение Вита 12.11).
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,  -- артикул, 5 знаков
  collection_id INTEGER NOT NULL REFERENCES collections(id),
  brand_id INTEGER REFERENCES brands(id),    -- бренд артикула: в 24 коллекциях артикулы разных брендов
  kind_id INTEGER REFERENCES kinds(id),
  decor TEXT, purpose TEXT, type TEXT,
  format TEXT, format_w INTEGER, format_h INTEGER, thickness REAL,
  rect TEXT, frost TEXT,                     -- считаются по правилам
  color TEXT, surface TEXT, relief TEXT,
  pei INTEGER, ptv TEXT, r TEXT,
  status TEXT NOT NULL DEFAULT 'active',     -- active | withdrawn
  withdrawn_year INTEGER,
  network_id INTEGER REFERENCES networks(id), -- эксклюзив этого артикула
  year INTEGER, comment TEXT,
  factory_code TEXT,                         -- заводской код первого сорта (6 знаков)
  ean TEXT, pcs REAL, m2pack REAL, w1 REAL, wpack REAL, packs_pal REAL, m2pal REAL, wpal REAL, pack_note TEXT,
  created TEXT NOT NULL, updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS articles_collection ON articles(collection_id);
-- Несколько значений у артикула: применение, тип дизайну
CREATE TABLE IF NOT EXISTS article_values (article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, field TEXT NOT NULL, value TEXT NOT NULL, pos INTEGER NOT NULL, PRIMARY KEY (article_id, field, pos));
CREATE TABLE IF NOT EXISTS article_groups (article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, group_id INTEGER NOT NULL REFERENCES groups(id), PRIMARY KEY (article_id, group_id));

-- Картинки и файлы (сами файлы — на сети и на Google Диске, здесь только сведения о них)
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL,  -- photo | face | render | live | video
  collection_id INTEGER REFERENCES collections(id),
  path TEXT NOT NULL UNIQUE, drive_id TEXT, flags TEXT, width INTEGER, height INTEGER, mtime TEXT
);
CREATE TABLE IF NOT EXISTS media_articles (media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE, article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE, PRIMARY KEY (media_id, article_id));

-- История изменений: что, когда, кто, откуда
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY, time TEXT NOT NULL, user TEXT NOT NULL, source TEXT,
  entity TEXT NOT NULL, record TEXT NOT NULL, field TEXT, old TEXT, new TEXT
);
CREATE INDEX IF NOT EXISTS history_record ON history(entity, record);

-- Пользователи: полная роль (Вит) и только просмотр (менеджеры)
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'viewer', key_hash TEXT UNIQUE, created TEXT NOT NULL, revoked TEXT);
