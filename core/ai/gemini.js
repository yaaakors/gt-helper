// Подключение к Gemini. Сменная часть: любой другой ИИ делается таким же файлом
// с теми же двумя функциями (check, json).
'use strict';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

async function call(url, key, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET', signal: ctrl.signal,
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { /* не JSON */ }
    if (!res.ok) throw new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
    return data;
  } finally { clearTimeout(timer); }
}

/** Проверка ключа: список моделей, умеющих отвечать на запросы */
async function check(key) {
  const data = await call(`${BASE}/models?pageSize=200`, key);
  return (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
}

/** Запрос с ответом в виде JSON */
async function json({ key, model, system, user }) {
  const data = await call(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, key, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });
  const text = (((data.candidates || [])[0] || {}).content || {}).parts?.map((p) => p.text || '').join('') || '';
  try { return JSON.parse(text); } catch { throw new Error('ИИ вернул ответ не в том виде'); }
}
module.exports = { check, json };
