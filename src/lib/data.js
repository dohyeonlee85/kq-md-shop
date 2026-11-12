// 빌드 시 데이터 로드: products.csv(상품) · copy.csv(한/영 문구) · site.json(배너·칩·설정)
import fs from 'node:fs';
import path from 'node:path';
import siteJson from '../data/site.json';

const root = process.cwd();
const read = (f) => fs.readFileSync(path.join(root, 'src/data', f), 'utf8').replace(/^﻿/, '');

export function parseCSV(text) {
  const rows = [];
  let row = [], cur = '', q = false;
  const endRow = () => { row.push(cur); cur = ''; if (row.some((v) => v !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else cur += c;
  }
  endRow();
  const head = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

// 사진: public/images/{폴더}/{이름}.(webp|jpg|jpeg|png) 있으면 사용, 없으면 회색 상자
export function img(folder, name) {
  for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
    if (fs.existsSync(path.join(root, 'public/images', folder, `${name}.${ext}`))) return `/images/${folder}/${name}.${ext}`;
  }
  return null;
}

const NUM = ['sort', 'proposal', 'price_krw', 'price_usd', 'low_stock_at', 'limit_per_account', 'intl_ship', 'bonus', 'season_limited', 'chart', 'ship_days', 'sales', 'preorder_count', 'order_qty', 'today_orders_kr', 'today_orders_intl', 'notify_kr', 'notify_intl'];
export const products = parseCSV(read('products.csv')).map((p) => {
  for (const k of NUM) p[k] = Number(p[k] || 0);
  p.options = p.options ? p.options.split('|').map((s) => s.trim()) : [''];
  p.stock = String(p.stock || '0').split('|').map((s) => Number(s) || 0);
  while (p.stock.length < p.options.length) p.stock.push(0);
  p.img = img('product', `${p.id}_main`);
  p.details = [1, 2].map((n) => ({ name: `${p.id}_detail${n}.jpg`, src: img('product', `${p.id}_detail${n}`) }));
  return p;
});

export const copy = Object.fromEntries(parseCSV(read('copy.csv')).map((r) => [r.key, { ko: r.ko, en: r.en }]));
export const site = siteJson;

// 시즌 배경색: 대표 컷(poster)에서 빌드 시 추출, 사진 없으면 회색 톤
export async function seasonColor(artist) {
  const src = img('poster', `${artist}_poster`);
  if (!src) return '#3f3f46';
  try {
    const sharp = (await import('sharp')).default;
    const { data } = await sharp(path.join(root, 'public', src)).resize(1, 1).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = data;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const k = lum > 70 ? 70 / lum : 1; // 흰 글자 대비 확보
    return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
  } catch {
    return '#3f3f46';
  }
}
