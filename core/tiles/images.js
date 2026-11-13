// Оптимизация картинок при раскладке по папкам: убрать служебные данные, перевести в sRGB, пережать.
// Размер в пикселях и плотность (dpi) не меняются. Исходный файл не трогаем.
'use strict';
const fs = require('fs');
const path = require('path');

let lib; let libError = '';
function sharp() {
  if (lib === undefined) { try { lib = require('sharp'); lib.cache(false); } catch (e) { lib = null; libError = String(e.message || e).split('\n')[0]; } }
  return lib;
}

/** Плотность в заголовке JPEG (после пережатия она сбрасывается в 72 — возвращаем исходную) */
function setJpegDpi(buf, dpi) {
  if (!dpi || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  if (buf[2] === 0xff && buf[3] === 0xe0 && buf.toString('latin1', 6, 10) === 'JFIF') { buf[13] = 1; buf.writeUInt16BE(d, 14); buf.writeUInt16BE(d, 16); return buf; }
  // заголовка с плотностью нет — добавляем его сразу после начала файла (1 = точек на дюйм)
  const head = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, d >> 8, d & 255, d >> 8, d & 255, 0x00, 0x00]);
  return Buffer.concat([buf.subarray(0, 2), head, buf.subarray(2)]);
}

/**
 * Положить картинку src в dest (dest не должен существовать).
 * Возвращает { before, after, mode: 'optimized' | 'kept' | 'copied', note }.
 * opts.dpi — принудительная плотность (для изображений товара — 150); иначе сохраняется исходная.
 */
async function save(src, dest, opts) {
  const before = fs.statSync(src).size; const ext = path.extname(src).toLowerCase();
  const plain = (mode, note) => { fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL); return { before, after: before, mode, note: note || '' }; };
  const kind = ['.jpg', '.jpeg'].includes(ext) ? 'jpeg' : ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : '';
  if (!kind) return plain('copied', 'этот вид файлов не оптимизирую');
  const S = sharp();
  if (!S) return plain('copied', 'оптимизация недоступна: ' + libError);
  let meta; let buf;
  try {
    meta = await S(src, { failOn: 'none' }).metadata();
    let p = S(src, { failOn: 'none' }).rotate(); // поворот из служебных данных применяем к самой картинке — иначе после очистки она «ляжет на бок»
    if (kind === 'jpeg') p = p.jpeg({ quality: 85, mozjpeg: true });
    else if (kind === 'png') p = p.png({ compressionLevel: 9, effort: 10 }); // без потерь
    else p = p.webp({ quality: 85 });
    buf = await p.toBuffer(); // служебные данные и цветовой профиль не переносятся; цвета пересчитаны в sRGB
  } catch (e) { return plain('copied', 'не смог обработать: ' + String(e.message || e).split('\n')[0]); }
  const dpi = (opts && opts.dpi) || meta.density || 0;
  if (kind === 'jpeg') buf = setJpegDpi(buf, dpi || 72);
  const wasRgb = meta.space === 'srgb' || meta.space === 'b-w';
  // уже лёгкий файл в sRGB: пережатие ничего не даст, а качество тронет — кладём как есть
  if (wasRgb && !meta.icc && !meta.exif && !meta.xmp && !meta.iptc && buf.length >= before * 0.97 && !(opts && opts.dpi)) return plain('kept');
  if (wasRgb && buf.length >= before && !(opts && opts.dpi)) return plain('kept');
  fs.writeFileSync(dest, buf, { flag: 'wx' });
  // проверка: файл читается, размер в пикселях тот же
  try {
    const out = await S(dest).metadata(); const turned = (meta.orientation || 1) >= 5;
    const w = turned ? meta.height : meta.width; const h = turned ? meta.width : meta.height;
    if (out.width !== w || out.height !== h) throw new Error(`размер в пикселях изменился: ${w}x${h} → ${out.width}x${out.height}`);
  } catch (e) { try { fs.unlinkSync(dest); } catch { /* не успел создаться */ } return plain('copied', 'проверка после оптимизации не прошла (' + String(e.message || e).split('\n')[0] + ') — положил исходный файл'); }
  return { before, after: buf.length, mode: 'optimized', note: wasRgb ? '' : `цвета переведены в sRGB (было: ${String(meta.space).toUpperCase()})` };
}

const sizeText = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ');

module.exports = { save, sizeText, available: () => !!sharp(), error: () => libError };
