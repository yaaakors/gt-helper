// Темы оформления. Каждый цвет можно переопределить в Настройках.
'use strict';
const ELEMENTS = [
  ['bg', 'Фон окна'], ['card', 'Карточки и поля ввода'], ['text', 'Основной текст'], ['muted', 'Второстепенный текст'],
  ['line', 'Разделительные линии'], ['field', 'Рамки полей и кнопок'], ['tone', 'Кнопки и выделение'], ['gold', 'Акцент'],
];
const THEMES = {
  'dark-warm': { name: 'Тёмная тёплая', dark: true, colors: { bg: '#262624', card: '#30302e', text: '#ebe9e2', muted: '#b3b0a6', line: '#403f3b', field: '#7d7a71', tone: '#3b3a36', gold: '#c2ad7a', ok: '#7fbf93', warn: '#d9ad5c', bad: '#e0897b' } },
  'light-warm': { name: 'Светлая тёплая', dark: false, colors: { bg: '#faf9f5', card: '#ffffff', text: '#1f1e1d', muted: '#5e5d59', line: '#e5e2d8', field: '#8f8c82', tone: '#efece3', gold: '#aa9767', ok: '#3c7a4f', warn: '#9a6a1c', bad: '#a24a3c' } },
  'dark-graphite': { name: 'Тёмная графитовая', dark: true, colors: { bg: '#1f2225', card: '#26292d', text: '#d9dcdf', muted: '#a0a6ac', line: '#3a3f44', field: '#6b7279', tone: '#33383d', gold: '#b9a678', ok: '#7fbf93', warn: '#d9ad5c', bad: '#e0897b' } },
  'light-grey': { name: 'Светлая серая', dark: false, colors: { bg: '#eff0f2', card: '#ffffff', text: '#26282b', muted: '#5c6268', line: '#dcdfe3', field: '#878d94', tone: '#e1e4e8', gold: '#aa9767', ok: '#3c7a4f', warn: '#9a6a1c', bad: '#a24a3c' } },
};
const DEFAULT = 'dark-warm';
const HEX = /^#[0-9a-f]{6}$/i;

/** Итоговые цвета: тема + то, что человек поменял сам */
function resolve(theme, overrides) {
  const base = THEMES[theme] || THEMES[DEFAULT];
  const colors = Object.assign({}, base.colors);
  for (const [k] of ELEMENTS) if (overrides && HEX.test(overrides[k] || '')) colors[k] = overrides[k].toLowerCase();
  return colors;
}
function describe(theme, overrides) {
  const id = THEMES[theme] ? theme : DEFAULT;
  return {
    id, colors: resolve(id, overrides), changed: Object.keys(overrides || {}).filter((k) => HEX.test(overrides[k] || '')),
    themes: Object.entries(THEMES).map(([key, t]) => ({ id: key, name: t.name, bg: t.colors.bg, text: t.colors.text, gold: t.colors.gold })),
    elements: ELEMENTS.map(([key, label]) => ({ key, label })),
  };
}
module.exports = { THEMES, ELEMENTS, DEFAULT, resolve, describe };
