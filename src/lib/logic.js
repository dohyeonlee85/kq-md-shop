// 화면(빌드)과 브라우저가 같이 쓰는 규칙: 상태·딱지·정렬·카드·구매 영역
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ENT[c]);
export const makeT = (copy) => (k, v = {}) => {
  const c = copy[k] || { ko: k, en: k };
  const f = (s) => esc(s).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '');
  return `<span class="ko">${f(c.ko)}</span><span class="en">${f(c.en)}</span>`;
};
export const dual = (ko, en) => `<span class="ko">${esc(ko)}</span><span class="en">${esc(en)}</span>`;
export const price = (p) => `<span class="kr">₩${p.price_krw.toLocaleString('en-US')}</span><span class="intl">$${p.price_usd.toFixed(2)}</span>`;

export const stocks = (p, st) => st?.stock?.[p.id] ?? p.stock;
export const total = (p, st) => stocks(p, st).reduce((a, b) => a + b, 0);
export const lowAt = (p, st) => st?.low?.[p.id] ?? p.low_stock_at;
export function status(p, st) {
  const s = total(p, st);
  if (s <= 0) return 'soldout';
  if (p.sale_type === 'preorder') return 'preorder';
  return s <= lowAt(p, st) ? 'low' : 'onsale';
}
export const dday = (p, today) => Math.round((Date.parse(p.preorder_end.slice(0, 10)) - Date.parse(today)) / 864e5);
export const fmtDate = (s) => (s ? s.slice(0, 10).replace(/-/g, '.') + (s.length > 10 ? ` ${s.slice(11)}` : '') : '');

const B = {
  soldout: ['SOLD OUT', 'bg-neutral-200 text-neutral-500'],
  preorder: ['PRE-ORDER', 'bg-neutral-900 text-white'],
  low: ['LOW STOCK', 'bg-rose-600 text-white'],
};
const SUB = 'border border-neutral-300 text-neutral-600';
const BONUS = 'bg-violet-100 text-violet-800';
const SEASON = 'bg-amber-100 text-amber-900';
const chip = (h, c) => `<span class="badge ${c}">${h}</span>`;
export const statusChip = (s) => (B[s] ? chip(B[s][0], B[s][1]) : '');

// 우선순위: 품절 > 예약 > 품절 임박 > 특전 > 시즌 한정 > 국내 전용, 최대 2개 (품절은 1개만)
export function badges(p, st, T) {
  const s = status(p, st);
  if (s === 'soldout') return statusChip(s);
  const list = [];
  if (B[s]) list.push(statusChip(s));
  if (p.bonus) list.push(chip(T('b.bonus'), BONUS));
  if (p.season_limited) list.push(chip(T('b.season'), SEASON));
  const kr = list.slice(0, 2).join('');
  if (p.intl_ship) return kr;
  // 해외 국가 선택 시에만 "국내 전용" 표시 (2번째 자리 고정)
  const intl = [...list.slice(0, 1), chip(T('b.kronly'), SUB)].join('');
  return `<span class="kr contents">${kr}</span><span class="intl contents">${intl}</span>`;
}
export function statusLine(p, st, T, today) {
  const s = status(p, st);
  if (s === 'soldout') return T('s.notify');
  if (s === 'preorder') return T('s.dday', { n: Math.max(dday(p, today), 0) });
  return '&nbsp;';
}
// 진열: 품절은 항상 맨 뒤. closing(기본) = 신규 MD → 예약(마감 임박순) → 판매 중 / new = 등록일 최신순 / popular = 판매량순
export function sortProducts(list, st, mode = 'closing') {
  const so = (p) => (status(p, st) === 'soldout' ? 1 : 0);
  if (mode === 'new') return [...list].sort((a, b) => so(a) - so(b) || b.listed.localeCompare(a.listed) || a.sort - b.sort);
  if (mode === 'popular') return [...list].sort((a, b) => so(a) - so(b) || b.sales - a.sales);
  if (st?.order?.length) {
    const ix = (p) => { const i = st.order.indexOf(p.id); return i < 0 ? 999 : i; };
    return [...list].sort((a, b) => ix(a) - ix(b));
  }
  const rank = (p) => { const s = status(p, st); return s === 'soldout' ? 3 : s === 'preorder' ? 0 : p.proposal ? 1 : 2; };
  return [...list].sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.preorder_end.localeCompare(b.preorder_end) : 0) || a.sort - b.sort);
}
export function imgBox(src, name, cls = '') {
  return `<div class="ph ${cls}"><span>${esc(name)}</span>${src ? `<img src="${src}" alt="" loading="lazy" decoding="async">` : ''}</div>`;
}
export function cardHTML(p, st, T, today) {
  const so = status(p, st) === 'soldout';
  return `<a href="/product/${p.id}/" class="card block" data-tab="${esc(p.tab)}">
  ${imgBox(p.img, `${p.id}_main.jpg`, `aspect-square ${so ? 'opacity-40' : ''}`)}
  <div class="mt-2 h-5 flex gap-1 overflow-hidden">${badges(p, st, T)}</div>
  <p class="mt-1 text-[13px] leading-snug line-clamp-2 min-h-[2.6em]">${dual(p.name_ko, p.name_en)}</p>
  <p class="mt-1 text-[15px] font-bold tabular-nums ${so ? 'text-neutral-400' : ''}">${price(p)}</p>
  <p class="text-[11px] text-neutral-500">${statusLine(p, st, T, today)}</p></a>`;
}
export const gridHTML = (list, st, T, today, mode) => sortProducts(list, st, mode).map((p) => cardHTML(p, st, T, today)).join('');

// 상세: 상태별 구매 버튼 1개 (품절 시 재입고 알림으로 대체)
export function buyHTML(p, st, T) {
  const s = status(p, st), sk = stocks(p, st);
  const first = sk.findIndex((n) => n > 0);
  const opts = p.options.length > 1 ? `<label for="opt" class="block text-xs text-neutral-500 mb-1">${T('d.option')}</label>
  <select id="opt" class="w-full h-11 border border-neutral-300 rounded px-3 bg-white">${p.options.map((o, i) => `<option value="${i}" ${sk[i] <= 0 ? 'disabled' : ''} ${i === first ? 'selected' : ''}>${esc(o)}${sk[i] <= 0 ? ' — SOLD OUT' : ''}</option>`).join('')}</select>` : '';
  const qty = `<div class="mt-3 flex items-center justify-between"><span class="text-sm">${T('d.qty')}</span>
  <div class="flex items-center border border-neutral-300 rounded"><button type="button" data-act="qty" data-d="-1" class="w-10 h-10" aria-label="-">−</button><span id="qty" class="w-10 text-center tabular-nums">1</span><button type="button" data-act="qty" data-d="1" class="w-10 h-10" aria-label="+">+</button></div></div>
  ${p.limit_per_account ? `<p class="mt-1 text-xs text-neutral-500 text-right">${T('d.limit', { n: p.limit_per_account })}</p>` : ''}`;
  const cart = '<button type="button" data-act="cart" class="btn btn-line !w-14 flex-none !px-0" aria-label="Add to cart"><svg class="h-6 w-6 fill-none stroke-current" viewBox="0 0 24 24" stroke-width="1.6"><path d="M5 8h14l-1.2 12H6.2L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/><path d="M12 11v6M9 14h6"/></svg></button>';
  const main = s === 'soldout'
    ? `<button type="button" data-act="notify" class="btn btn-line w-full">${T('d.notify')}</button>`
    : `<div class="flex gap-2">${cart}<button type="button" data-act="order" class="btn btn-ink min-w-0 flex-1">${T(s === 'preorder' ? 'd.pre' : 'd.buy')}</button></div>`;
  const btn = p.intl_ship || s === 'soldout' ? main
    : `<div class="kr">${main}</div><div class="intl"><button type="button" disabled class="btn w-full bg-neutral-200 text-neutral-500 cursor-not-allowed">${T('d.kronly')}</button></div>`;
  return `<div>${s === 'soldout' ? '' : opts + qty}</div>
  <div id="buybtn" class="mt-4">${btn}</div>`;
}
