// 관리자 데모: 가공 주문(orders.csv) 1개를 원본으로 전 화면 숫자 계산. 이 브라우저에만 저장·매일 초기화.
// 단계 이동 규칙은 이 파일 advance() 1곳에만 있음.
import * as app from './app.js';
import { DATA, products, site, save, paint, toast } from './app.js';
import { status, stocks, total, lowAt, statusChip, sku, esc, fmtDate, sortProducts } from './logic.js';

const $ = (s) => document.querySelector(s);
const n = (v) => Number(v).toLocaleString('en-US');
const won = (v) => '₩' + n(v);
const P = Object.fromEntries(products.map((p) => [p.id, p]));
const S = () => app.state; // 쇼핑몰과 공유: 가용 재고·LOW 기준·재입고 알림 신청
const KEY = 'kq_admin_v1';
const realDay = () => new Date().toLocaleDateString('sv');
const dateOf = (off) => new Date(Date.parse(site.today) + off * 864e5).toISOString().slice(0, 10);
const md = (d) => (d ? d.slice(5).replace('-', '/') : '-');

const RULES = [
  ['R1', '결제 완료', '주문 접수 · 재고 할당(가용 → 출고 대기 / 예약 할당)'],
  ['R2', '출고 준비 완료', '피킹 리스트 · 송장 번호 일괄 생성'],
  ['R3', '송장 등록', '배송 알림 발송 · 주소 변경 잠금'],
  ['R4', '', '수령 처리'],
  ['R5', '가용 재고 ≤ LOW 기준', '발주서 초안 생성(최근 7일 판매량 기준)'],
  ['R6', '입고 검수 승인', '가용 재고 전환 · 품절 해제 · 재입고 알림 발송'],
  ['R7', '수령 다음 날', '정산 집계(매출 · 환불)'],
];
const STAGE = { pay: '결제 확인', ready: '출고 준비', shipped: '배송 중', delivered: '수령', closed: '정산 완료', reserved: '예약 할당', return_req: '교환·반품 접수', returned: '교환·반품 완료' };

function fresh() {
  return { day: realDay(), off: 0, orders: DATA.orders.map((o) => ({ ...o })), pos: site.pos.map((x) => ({ ...x })), log: [], slog: [], rules: Object.fromEntries(RULES.map((r) => [r[0], 1])), defect: {}, preAdd: {}, sent: {}, seq: 0, filter: 'all', cs: seedCS(), plog: [], added: [], poTab: 'po', edit: null, tab: '' };
}
function load() {
  try { const a = JSON.parse(localStorage.getItem(KEY)); if (a && a.day === realDay()) return a; } catch {}
  const a = fresh(); ruleR5(a); return a;
}
let A;
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(A)); } catch {} save(); };
const today = () => dateOf(A.off);
const log = (rule, text, a = A) => a.log.unshift({ d: dateOf(a.off), rule, text });

// ── 재고 (가용 = 쇼핑몰 딱지 기준)
const avail = (p, j) => stocks(p, S())[j];
function setAvail(p, j, v) { const a = [...stocks(p, S())]; a[j] = Math.max(0, v); S().stock[p.id] = a; }
const waiting = (p, j) => A.orders.filter((o) => o.pid === p.id && o.opt === j && o.status === 'ready').reduce((s, o) => s + o.qty, 0);
const reserved = (p) => p.preorder_count + (A.preAdd[p.id] || 0);
const sold7 = (p, a = A) => { const from = dateOf(a.off - 6); return a.orders.filter((o) => o.pid === p.id && o.date >= from && !['reserved', 'returned'].includes(o.status)).reduce((s, o) => s + o.qty, 0); };
const notifyOf = (p) => ({ kr: p.notify_kr + (S().notify[p.id] || 0), intl: p.notify_intl });

// ── 자동화 규칙 R5: 가용 ≤ 기준 → 발주서 초안
function ruleR5(a = A) {
  if (!a.rules.R5) return;
  for (const p of products) {
    if (p.sale_type === 'preorder') continue;
    const st = status(p, S());
    if (st !== 'low' && st !== 'soldout') continue;
    if (a.pos.some((x) => x.pid === p.id && x.status !== 'received')) continue;
    const nt = notifyOf(p), need = st === 'soldout' ? Math.ceil(((nt.kr + nt.intl) * site.restock_conversion) / 10) * 10 : sold7(p, a) * 2;
    const j = stocks(p, S()).indexOf(Math.min(...stocks(p, S())));
    if (st === 'soldout' && need < p.moq) continue; // 대기 수요가 최소 발주 수량 미달 → 보류
    const d = dateOf(a.off);
    a.pos.push({ id: `PO-${d.slice(5, 7)}${d.slice(8)}-${String(a.pos.filter((x) => x.id.slice(3, 7) === d.slice(5, 7) + d.slice(8)).length + 1).padStart(2, '0')}`, pid: p.id, opt: j, qty: Math.max(p.moq, need), date: d, eta: '', status: 'draft', note: `자동 제안: ${st === 'soldout' ? '재입고 대기 수요' : '최근 7일 판매 ' + sold7(p, a) + '개 × 2주'} → 최소 발주 ${p.moq}` });
    log('R5', `${sku(p, j)} 가용 ${total(p, S())} ≤ 기준 → 발주서 초안 생성`, a);
  }
}

// ── 하루 진행: 자동 처리분만 다음 단계로, 사람 승인 건은 대기
function advance() {
  A.off++;
  const d = today(), r = A.rules, cnt = (f) => A.orders.filter(f);
  if (r.R7) { const l = cnt((o) => o.status === 'delivered' && o.doneDate !== undefined ? o.doneDate < d : o.status === 'delivered'); l.forEach((o) => (o.status = 'closed')); if (l.length) log('R7', `정산 집계 ${l.length}건`); }
  if (r.R4) { const l = cnt((o) => o.status === 'shipped'); l.forEach((o) => { o.status = 'delivered'; o.doneDate = d; }); if (l.length) log('R4', `배송 완료 → 수령 처리 ${l.length}건`); }
  if (r.R2) {
    const l = cnt((o) => o.status === 'ready' && o.date < d);
    l.forEach((o) => { o.status = 'shipped'; o.tracking = `${d.slice(5, 7)}${d.slice(8)}-${1000 + ++A.seq}`; });
    if (l.length) { log('R2', `피킹 리스트 · 송장 번호 생성 ${l.length}건 (포장은 창고 작업)`); if (r.R3) log('R3', `배송 알림 발송 ${l.length}건 · 주소 변경 잠금`); }
  }
  if (r.R1) { const l = cnt((o) => o.status === 'pay' && !o.flag); l.forEach(accept); if (l.length) log('R1', `대기 주문 접수 · 재고 할당 ${l.length}건`); }
  // 신규 주문 12건 (원본 주문 표를 순서대로 반복, 난수 없음)
  let ok = 0, pre = 0, skip = 0;
  for (let i = 1; i <= 12; i++) {
    const t = DATA.orders[(A.off * 12 + i * 7) % DATA.orders.length], p = P[t.pid];
    const o = { no: `KQ-${d.slice(5, 7)}${d.slice(8)}-${String(i).padStart(3, '0')}`, date: d, country: t.country, pid: t.pid, opt: t.opt, qty: Math.min(t.qty, 3), status: 'pay', tracking: '', flag: '', reason: '' };
    if (p.sale_type !== 'preorder' && avail(p, o.opt) < o.qty) { skip++; continue; } // 품절·재고 부족 → 쇼핑몰에서 주문 불가
    A.orders.push(o);
    if (r.R1) { accept(o); p.sale_type === 'preorder' ? pre++ : ok++; }
  }
  if (r.R1 && ok + pre) log('R1', `신규 주문 ${ok + pre}건 접수 · 재고 할당 ${ok}건 · 예약 할당 ${pre}건`);
  for (const x of A.pos) if (x.status === 'confirmed' && x.eta && x.eta <= d) { x.status = 'inspect'; log('입고', `${x.id} 입고 예정일 도달 → 검수 승인 대기`); }
  ruleR5();
  persist(); paint(); render();
}
function accept(o) {
  const p = P[o.pid];
  if (p.sale_type === 'preorder') { o.status = 'reserved'; A.preAdd[p.id] = (A.preAdd[p.id] || 0) + o.qty; return; }
  setAvail(p, o.opt, avail(p, o.opt) - o.qty); o.status = 'ready';
}

// ── 1:1 문의 가공 5건 (주문 원본의 주문번호·상품 코드 사용)
function seedCS() {
  const O = DATA.orders, f = (fn) => O.find(fn) || O[0], d0 = dateOf(-2), d1 = dateOf(-1), d2 = dateOf(0);
  const ship = f((o) => o.status === 'shipped'), bad = f((o) => o.status === 'delivered' || o.status === 'closed'), ready = f((o) => o.status === 'ready'), intl = f((o) => o.country === 'US') ;
  const so = products.find((p) => p.stock.every((v) => v === 0)) || products[0];
  return [
    { id: 'CS-01', at: d0, type: '불량 · 교환', lang: 'KR', no: bad.no, pid: bad.pid, opt: bad.opt, q: '포장 개봉 시 본품 모서리 파손 확인. 교환 요청합니다.', st: '접수', ans: '' },
    { id: 'CS-02', at: d1, type: '배송', lang: 'EN', no: ship.no, pid: ship.pid, opt: ship.opt, q: 'When will my order arrive? Tracking has not updated for 2 days.', st: '접수', ans: '' },
    { id: 'CS-03', at: d1, type: '주소 변경', lang: 'KR', no: ready.no, pid: ready.pid, opt: ready.opt, q: '배송지 동·호수 변경 원합니다.', st: '처리 중', ans: '' },
    { id: 'CS-04', at: d2, type: '관세 · 배송비', lang: 'EN', no: intl.no, pid: intl.pid, opt: intl.opt, q: 'Do I need to pay customs duties for this order?', st: '접수', ans: '' },
    { id: 'CS-05', at: d2, type: '재입고', lang: 'JP', no: '', pid: so.id, opt: 0, q: '再入荷の予定はありますか？', st: '접수', ans: '' },
  ];
}
const TPL = {
  '불량 · 교환': '불편을 드려 죄송합니다. 교환 상품을 출고 준비로 등록했습니다. 기존 상품은 회수 기사 방문 시 전달 부탁드립니다.',
  '배송': '주문 상품은 출고되어 배송 중입니다. 송장 번호로 배송 조회가 가능합니다. 국가별 통관 일정에 따라 조회 갱신이 늦어질 수 있습니다.',
  '주소 변경': '해당 주문은 출고 준비 단계로 주소 변경이 잠겨 있습니다. 배송 시작 후 택배사를 통해 변경을 요청해 주십시오.',
  '관세 · 배송비': '관세·부가세는 상품가에 포함되지 않으며 구매자 부담입니다. 금액은 도착 국가 세관 기준으로 부과됩니다.',
  '재입고': '재입고 일정은 확정 후 재입고 알림으로 안내드립니다. 상품 페이지에서 재입고 알림을 신청해 주십시오.',
};

// ── 사람 승인 3종 + 이상 주문
function approvals() {
  const list = [];
  A.orders.filter((o) => o.status === 'pay' && o.flag).forEach((o) => list.push({ k: 'hold', id: o.no, t: '이상 주문 확인', d: `${o.no} · ${sku(P[o.pid], o.opt)} × ${o.qty} · ${o.reason}` }));
  A.pos.filter((x) => x.status === 'draft').forEach((x) => list.push({ k: 'po', id: x.id, t: '발주 수량 확정', d: `${x.id} · ${sku(P[x.pid], x.opt)} × ${n(x.qty)} · ${x.note}` }));
  A.pos.filter((x) => x.status === 'inspect').forEach((x) => list.push({ k: 'insp', id: x.id, t: '입고 검수 승인', d: `${x.id} · ${sku(P[x.pid], x.opt)} × ${n(x.qty)} · 창고 실물 확인 후 승인` }));
  A.orders.filter((o) => o.status === 'return_req').forEach((o) => list.push({ k: 'ret', id: o.no, t: '교환·반품 승인', d: `${o.no} · ${sku(P[o.pid], o.opt)} × ${o.qty} · ${o.reason}` }));
  return list;
}
function approve(k, id) {
  if (k === 'hold') { const o = A.orders.find((x) => x.no === id), p = P[o.pid]; o.flag = ''; if (avail(p, o.opt) >= o.qty || p.sale_type === 'preorder') accept(o); else { o.status = 'returned'; o.reason = '재고 부족으로 취소'; } log('승인', `${id} 이상 주문 확인 → 접수`); }
  if (k === 'po') { const x = A.pos.find((y) => y.id === id), p = P[x.pid]; x.status = 'confirmed'; x.date = today(); x.eta = dateOf(A.off + p.lead_days); log('승인', `${id} 발주 확정 · 입고 예정 ${md(x.eta)}`); }
  if (k === 'insp') {
    const x = A.pos.find((y) => y.id === id), p = P[x.pid], was = total(p, S());
    const inq = Math.max(0, Math.floor(Number($(`[data-inq="${id}"]`)?.value ?? x.qty) || 0)), bad = Math.min(inq, Math.max(0, Math.floor(Number($(`[data-inb="${id}"]`)?.value) || 0))), good = inq - bad;
    x.status = 'received'; x.done = today(); x.inq = inq; x.bad = bad; setAvail(p, x.opt, avail(p, x.opt) + good);
    if (bad) { const c = sku(p, x.opt); A.defect[c] = (A.defect[c] || 0) + bad; }
    log('승인', `${id} 검수 승인 · 입고 ${n(inq)} (양품 ${n(good)} · 불량 ${n(bad)})`);
    if (A.rules.R6) {
      const nt = notifyOf(p), wake = A.orders.filter((o) => o.pid === p.id && o.status === 'reserved');
      wake.forEach((o) => { setAvail(p, o.opt, avail(p, o.opt) - o.qty); o.status = 'ready'; });
      log('R6', `${sku(p, x.opt)} 가용 +${n(good)}${was <= 0 ? ' · 품절 해제' : ''}${nt.kr + nt.intl ? ` · 재입고 알림 ${n(nt.kr + nt.intl)}명 발송` : ''}${wake.length ? ` · 예약 주문 ${wake.length}건 출고 준비` : ''}`);
      if (nt.kr + nt.intl) A.sent[p.id] = today();
    }
  }
  if (k === 'ret') {
    const o = A.orders.find((x) => x.no === id), p = P[o.pid], bad = o.reason.startsWith('불량'), c = sku(p, o.opt);
    o.status = 'returned';
    if (bad) A.defect[c] = (A.defect[c] || 0) + o.qty; else setAvail(p, o.opt, avail(p, o.opt) + o.qty);
    log('승인', `${id} 반품 승인 → ${bad ? '불량 재고 +' + o.qty : '가용 재고 +' + o.qty} · 환불 집계`);
  }
  ruleR5(); persist(); paint(); render();
}

// ── 화면
const tag = (t, c) => `<span class="inline-block rounded px-1.5 py-0.5 text-[11px] font-bold ${c}">${t}</span>`;
const AUTO = tag('자동', 'bg-emerald-100 text-emerald-800'), HUMAN = tag('승인 필요', 'bg-rose-100 text-rose-700'), PHYS = tag('창고 작업', 'bg-neutral-200 text-neutral-700');
const VIEWS = ['dash', 'orders', 'stock', 'po', 'cs', 'banner', 'settings'];
const view = () => (VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dash');
const tile = (k, v, sub = '', href = '') => `<${href ? `a href="${href}"` : 'div'} class="block rounded-lg border border-neutral-200 bg-white p-4 ${href ? 'hover:border-neutral-900' : ''}"><p class="text-xs text-neutral-500">${k}</p><p class="mt-1 text-2xl font-black tabular-nums">${v}</p><p class="mt-1 text-[11px] text-neutral-500">${sub || '&nbsp;'}</p></${href ? 'a' : 'div'}>`;
const count = (s) => A.orders.filter((o) => o.status === s).length;
const openCS = () => A.cs.filter((c) => c.st !== '완료');
const stamp = () => new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).slice(5, 16);
const csvDown = (name, rows) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map((r) => r.map((v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(',')).join('\n')], { type: 'text/csv' })); a.download = name; a.click(); };

function dash() {
  const d = today(), from = dateOf(A.off - 6), ap = approvals(), cs = openCS();
  const tod = A.orders.filter((o) => o.date === d), kr = tod.filter((o) => o.country === 'KR').length;
  const wk = A.orders.filter((o) => o.date >= from && !['reserved', 'returned'].includes(o.status));
  const rev = wk.reduce((s, o) => s + o.qty * P[o.pid].price_krw, 0), wkr = wk.filter((o) => o.country === 'KR').length;
  const dep = products.filter((p) => p.sale_type === 'preorder').reduce((s, p) => s + reserved(p) * p.price_krw, 0);
  const low = products.filter((p) => status(p, S()) === 'low').length, so = products.filter((p) => status(p, S()) === 'soldout').length;
  const rd = A.orders.filter((o) => o.status === 'ready'), rdk = rd.filter((o) => o.country === 'KR').length;
  const days = [...Array(7)].map((_, i) => dateOf(A.off - 6 + i)), series = days.map((x) => A.orders.filter((o) => o.date === x).length), mx = Math.max(...series, 1);
  const nt = products.map(notifyOf).reduce((s, x) => s + x.kr + x.intl, 0), cl = S().clicks;
  const by = (k) => ap.filter((x) => x.k === k).length;
  const top = products.map((p) => [p, wk.filter((o) => o.pid === p.id).reduce((s, o) => s + o.qty, 0)]).filter((x) => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const late = cs.filter((c) => c.at < dateOf(A.off - 1)).length;
  $('#a-dash').innerHTML = `
    ${ap.length + cs.length ? `<div class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
      <a href="#orders" class="font-bold underline">처리 대기 ${ap.length}건</a><span>이상 주문 ${by('hold')} · 발주 확정 ${by('po')} · 입고 검수 ${by('insp')} · 교환·반품 ${by('ret')}</span>
      <a href="#cs" class="font-bold underline">미처리 문의 ${cs.length}건${late ? ` (24시간 초과 ${late})` : ''}</a></div>` : ''}
    <div class="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      ${tile('오늘 주문 (' + md(d) + ')', n(tod.length), `국내 ${kr} · 해외 ${tod.length - kr}`, '#orders')}
      ${tile('출고 대기', n(rd.length), `국내 ${rdk} · 해외 ${rd.length - rdk}`, '#orders')}
      ${tile('최근 7일 매출', won(rev), `국내 ${wk.length ? Math.round((wkr / wk.length) * 100) : 0}% · 해외 ${wk.length ? 100 - Math.round((wkr / wk.length) * 100) : 0}%`)}
      ${tile('예약 선수금', won(dep), '', '#po')}
      ${tile('LOW STOCK / SOLD OUT', `${low} / ${so}`, '', '#stock')}
    </div>
    <div class="mt-3 grid gap-3 xl:grid-cols-[1.4fr_1fr]">
      <div class="rounded-lg border border-neutral-200 bg-white p-4"><p class="text-xs text-neutral-500">최근 7일 주문 건수</p>
        <svg viewBox="-2 -2 104 36" preserveAspectRatio="none" class="mt-2 h-24 w-full"><polyline points="${series.map((v, i) => `${(i * 100) / 6},${30 - (v / mx) * 26}`).join(' ')}" fill="none" stroke="#111" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>
        <div class="mt-1 grid grid-cols-7 text-center text-[11px] tabular-nums">${days.map((x, i) => `<div><b>${series[i]}</b><br><span class="text-neutral-500">${md(x)}</span></div>`).join('')}</div></div>
      <div class="rounded-lg border border-neutral-200 bg-white p-4"><p class="text-xs text-neutral-500">최근 7일 판매 TOP 5</p>
        <table class="adm mt-1"><thead><tr><th></th><th>상품</th><th class="text-right">수량</th><th class="text-right">가용</th></tr></thead><tbody>${top.map(([p, q], i) => `<tr><td class="font-bold">${i + 1}</td><td>${esc(p.name_ko)}</td><td class="text-right tabular-nums">${n(q)}</td><td class="text-right tabular-nums">${n(total(p, S()))}</td></tr>`).join('') || '<tr><td colspan="4" class="text-neutral-500">-</td></tr>'}</tbody></table></div>
    </div>
    <p class="mt-2 text-[11px] text-neutral-400">배너 클릭 ${n(site.clicks.banner + cl.banner)} · 포스터 예약 클릭 ${n(site.clicks.poster + cl.poster)} · 재입고 알림 신청 ${n(nt)}</p>`;
}

function orders() {
  const ap = approvals();
  const step = (k, s, tags) => `<button type="button" data-filter="${s}" class="min-w-[120px] flex-1 rounded-lg border p-3 text-left ${A.filter === s ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white'}"><p class="text-xs">${k}</p><p class="text-2xl font-black tabular-nums">${count(s)}</p><p class="mt-1 flex flex-wrap gap-1">${tags}</p></button>`;
  $('#a-steps').innerHTML = `
    <div class="flex gap-2 overflow-x-auto pb-1">${step('결제 확인', 'pay', AUTO + HUMAN)}${step('출고 준비', 'ready', AUTO + PHYS)}${step('배송 중', 'shipped', AUTO)}${step('수령', 'delivered', AUTO)}${step('정산 완료', 'closed', AUTO)}</div>
    <div class="mt-2 flex gap-2 overflow-x-auto pb-1">${step('예약 할당', 'reserved', AUTO)}${step('교환·반품 접수', 'return_req', HUMAN)}${step('교환·반품 완료', 'returned', AUTO)}
      <button type="button" data-filter="all" class="min-w-[120px] flex-1 rounded-lg border p-3 text-left ${A.filter === 'all' ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white'}"><p class="text-xs">전체</p><p class="text-2xl font-black tabular-nums">${A.orders.length}</p></button></div>`;
  $('#a-appr').innerHTML = `<h3 class="font-bold">처리 대기 ${ap.length}건</h3>
    <div class="mt-2 overflow-x-auto"><table class="adm bg-white"><tbody>${ap.map((x) => `<tr><td class="whitespace-nowrap font-bold">${x.t}</td><td>${esc(x.d)}</td><td class="text-right"><button type="button" data-ap="${x.k}" data-id="${x.id}" class="btn btn-ink !h-10 !px-4 text-xs">승인</button></td></tr>`).join('') || '<tr><td class="text-neutral-500">처리 대기 없음</td></tr>'}</tbody></table></div>`;
  olist();
  $('#a-log').innerHTML = `<h3 class="font-bold">자동 처리 기록</h3><div class="mt-2 overflow-x-auto"><table class="adm bg-white"><thead><tr><th>일자</th><th>규칙</th><th>처리 내용</th></tr></thead><tbody>${A.log.slice(0, 12).map((l) => `<tr><td class="whitespace-nowrap">${md(l.d)}</td><td class="whitespace-nowrap font-bold">${l.rule}</td><td>${esc(l.text)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-neutral-500">기록 없음</td></tr>'}</tbody></table></div>`;
}
function olist() {
  const q = ($('#o-q')?.value || '').trim().toLowerCase(), f = $('#o-from')?.value, t = $('#o-to')?.value;
  const list = A.orders.filter((o) => (A.filter === 'all' || o.status === A.filter) && (!f || o.date >= f) && (!t || o.date <= t) && (!q || `${o.no} ${P[o.pid].name_ko} ${sku(P[o.pid], o.opt)}`.toLowerCase().includes(q))).sort((a, b) => b.no.localeCompare(a.no));
  $('#a-olist').innerHTML = `<p class="text-xs text-neutral-500">${A.filter === 'all' ? '전체' : STAGE[A.filter]} ${n(list.length)}건</p>
    <div class="mt-1 max-h-[420px] overflow-auto"><table class="adm bg-white"><thead><tr><th>주문번호</th><th>주문일</th><th>국가</th><th>옵션 코드</th><th>상품</th><th>수량</th><th>단계</th><th>송장</th></tr></thead><tbody>${list.slice(0, 100).map((o) => `<tr><td class="whitespace-nowrap tabular-nums">${o.no}</td><td>${md(o.date)}</td><td>${o.country}</td><td class="whitespace-nowrap">${sku(P[o.pid], o.opt)}</td><td class="min-w-[160px]">${esc(P[o.pid].name_ko)}</td><td>${o.qty}</td><td class="whitespace-nowrap">${STAGE[o.status]}${o.flag ? ' ' + HUMAN : ''}</td><td class="whitespace-nowrap tabular-nums">${o.tracking || '-'}</td></tr>`).join('') || '<tr><td colspan="8" class="text-neutral-500">검색 결과 없음</td></tr>'}</tbody></table></div>`;
}

const TABS = [...new Set(products.map((p) => p.tab))];
const ordered = () => { const ids = sortProducts(products, S(), 'closing').map((p) => p.id); return ids; };
function stock() {
  const list = ordered().map((id) => P[id]).filter((p) => !A.tab || p.tab === A.tab);
  const rsn = '<option>조정</option><option>입고</option><option>불량</option><option>실사</option>';
  $('#a-stock').innerHTML = `<table class="adm bg-white"><thead><tr><th>진열</th><th>옵션 코드</th><th>상품 · 옵션</th><th>가용</th><th>사유</th><th>예약 할당</th><th>출고 대기</th><th>불량</th><th>LOW 기준</th><th>상태</th><th></th></tr></thead><tbody>${list.map((p) => p.options.map((o, j) => `<tr ${j ? '' : `draggable="true" data-drag="${p.id}"`} class="${j ? '' : 'border-t-2 border-neutral-200'}">
      <td class="whitespace-nowrap">${j ? '' : `<span class="cursor-grab text-neutral-400" title="끌어서 이동">⋮⋮</span> <button type="button" data-mv="${p.id}" data-d="-1" class="h-10 w-9 rounded border border-neutral-300" aria-label="위로">↑</button><button type="button" data-mv="${p.id}" data-d="1" class="ml-1 h-10 w-9 rounded border border-neutral-300" aria-label="아래로">↓</button>`}</td>
      <td class="whitespace-nowrap font-bold">${sku(p, j)}</td><td class="min-w-[200px]">${esc(p.name_ko)}${o ? ' · ' + esc(o) : ''}<br><span class="text-xs text-neutral-500">${esc(p.tab)}</span></td>
      <td><input type="number" min="0" inputmode="numeric" data-stock="${p.id}" data-j="${j}" value="${avail(p, j)}"></td>
      <td><select data-rsn="${p.id}-${j}" class="h-10 rounded border border-neutral-300 bg-white px-1">${rsn}</select></td>
      <td class="tabular-nums">${j === 0 && p.sale_type === 'preorder' ? n(reserved(p)) : j ? '' : '0'}</td><td class="tabular-nums">${n(waiting(p, j))}</td><td class="tabular-nums">${A.defect[sku(p, j)] || 0}</td>
      ${j ? '<td></td><td></td><td></td>' : `<td><input type="number" min="0" inputmode="numeric" data-low="${p.id}" value="${lowAt(p, S())}"></td><td>${statusChip(status(p, S())) || '<span class="text-xs text-neutral-500">ON SALE</span>'}</td><td><button type="button" data-ed="${p.id}" class="btn btn-line !h-10 !px-3 text-xs">수정</button></td>`}</tr>`).join('')).join('')}</tbody></table>
    ${A.added.length ? `<h3 class="mt-4 font-bold">등록 상품 (게시 대기)</h3><table class="adm mt-2 bg-white"><thead><tr><th>상품 코드</th><th>상품명</th><th>카테고리</th><th>판매가</th><th>판매 방식</th><th>등록일</th></tr></thead><tbody>${A.added.map((x) => `<tr><td class="font-bold">${x.id}</td><td>${esc(x.name_ko)}</td><td>${esc(x.tab)}</td><td class="tabular-nums">${won(x.price_krw)}</td><td>${x.sale_type === 'preorder' ? '예약' : '일반'}</td><td>${x.at}</td></tr>`).join('')}</tbody></table>` : ''}`;
  $('#a-slog').innerHTML = A.slog.slice(0, 8).map((l) => `<tr><td class="whitespace-nowrap">${l.t}</td><td class="font-bold">${l.c}</td><td>${l.a} → ${l.b}</td><td>${l.r}</td></tr>`).join('') || '<tr><td colspan="4" class="text-neutral-500">기록 없음</td></tr>';
  $('#a-plog').innerHTML = A.plog.slice(0, 8).map((l) => `<tr><td class="whitespace-nowrap">${l.t}</td><td class="font-bold">${l.c}</td><td>${l.k}</td><td>${esc(l.a)} → ${esc(l.b)}</td></tr>`).join('') || '<tr><td colspan="4" class="text-neutral-500">기록 없음</td></tr>';
  editForm();
}
const FIELDS = [['name_ko', '상품명(한국어) *', 'text'], ['name_en', '상품명(영어)', 'text'], ['price_krw', '판매가(KRW)', 'number'], ['price_usd', '판매가(USD)', 'number'], ['limit_per_account', '1인 구매 제한', 'number'], ['weight', '무게(g)', 'number']];
const INFO = { ALBUM: [['tracks_ko', '수록곡'], ['components_ko', '구성']], 'SEASON\'S GREETINGS': [['components_ko', '구성'], ['size', '사이즈']], PHOTOBOOK: [['components_ko', '구성'], ['size', '사이즈']] };
function editForm() {
  const box = $('#a-edit'); if (!A.edit) { box.innerHTML = ''; return; }
  const isNew = A.edit === 'new', p = isNew ? { name_ko: '', name_en: '', price_krw: 0, price_usd: 0, limit_per_account: 10, weight: 0, tab: A.tab || TABS[0], sale_type: 'regular', intl_ship: 1, components_ko: '', size: '', material_ko: '', tracks_ko: '' } : { weight: 0, ...P[A.edit] };
  const info = INFO[p.tab] || [['material_ko', '소재'], ['size', '사이즈']];
  const inp = (k, label, type) => `<label class="text-xs text-neutral-600">${label}<input data-f="${k}" type="${type}" value="${esc(p[k] ?? '')}" class="mt-1 block h-10 w-full rounded border border-neutral-300 px-2 text-sm text-neutral-900"></label>`;
  box.innerHTML = `<div class="rounded-lg border-2 border-neutral-900 bg-white p-4">
    <div class="flex flex-wrap items-center gap-2"><h3 class="mr-auto font-bold">${isNew ? '상품 등록' : '상품 수정 · ' + sku(p)}</h3>
      ${isNew ? '' : '<button type="button" id="e-copy" class="btn btn-line !h-10 !px-3 text-sm">복제</button>'}
      <button type="button" id="e-cancel" class="btn btn-line !h-10 !px-3 text-sm">닫기</button><button type="button" id="e-save" class="btn btn-ink !h-10 !px-4 text-sm">저장</button></div>
    <div class="mt-3 grid gap-3 md:grid-cols-3">${FIELDS.map((f) => inp(...f)).join('')}
      <label class="text-xs text-neutral-600">카테고리<select data-f="tab" class="mt-1 block h-10 w-full rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900">${TABS.map((t) => `<option ${t === p.tab ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="text-xs text-neutral-600">판매 방식<select data-f="sale_type" class="mt-1 block h-10 w-full rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900"><option value="regular" ${p.sale_type !== 'preorder' ? 'selected' : ''}>일반</option><option value="preorder" ${p.sale_type === 'preorder' ? 'selected' : ''}>예약</option></select></label>
      <label class="flex items-center gap-2 pt-5 text-sm"><input data-f="intl_ship" type="checkbox" ${p.intl_ship ? 'checked' : ''} style="width:18px;height:18px"> 해외 배송 가능</label></div>
    <p class="mt-4 text-xs font-bold text-neutral-500">상품 정보 고시 (${esc(p.tab)})</p>
    <div class="mt-1 grid gap-3 md:grid-cols-2">${info.map(([k, l]) => inp(k, l, 'text')).join('')}</div></div>`;
}
function saveEdit(copy) {
  const v = {}; document.querySelectorAll('#a-edit [data-f]').forEach((el) => { v[el.dataset.f] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.type === 'number' ? Number(el.value) || 0 : el.value.trim(); });
  if (!v.name_ko) return toast('상품명(한국어)을 입력해 주십시오.');
  if (A.edit === 'new' || copy) {
    const id = `NEW-${String(A.added.length + 1).padStart(2, '0')}`;
    A.added.unshift({ ...v, id, name_ko: copy ? v.name_ko + ' (복제)' : v.name_ko, at: md(today()) });
    A.plog.unshift({ t: stamp(), c: id, k: copy ? '복제 등록' : '신규 등록', a: '-', b: v.name_ko });
    A.edit = null; persist(); stock(); return toast(v.name_en ? '등록했습니다. (게시 대기)' : '등록했습니다. 영어 상품명이 비어 있습니다.');
  }
  const p = P[A.edit], e = (S().edit ||= {}), cur = (e[p.id] ||= {}), LBL = Object.fromEntries([...FIELDS, ['tab', '카테고리'], ['sale_type', '판매 방식'], ['intl_ship', '해외 배송'], ...Object.values(INFO).flat(), ['material_ko', '소재'], ['size', '사이즈']]);
  let ch = 0;
  for (const [k, val] of Object.entries(v)) if (String(p[k] ?? (typeof val === 'number' ? 0 : '')) !== String(val)) { A.plog.unshift({ t: stamp(), c: sku(p), k: (LBL[k] || k).replace(' *', ''), a: String(p[k] ?? ''), b: String(val) }); p[k] = val; cur[k] = val; ch++; }
  A.edit = null; persist(); paint(); stock(); toast(ch ? `${ch}개 항목을 저장했습니다.` : '변경 사항이 없습니다.');
}
function move(id, dir) {
  const ids = ordered(), i = ids.indexOf(id), k = typeof dir === 'string' ? ids.indexOf(dir) : i + dir;
  if (i < 0 || k < 0 || k >= ids.length) return;
  ids.splice(i, 1); ids.splice(k, 0, id); S().order = ids; persist(); paint(); stock();
}

function po() {
  const TB = [['sched', '예약 일정'], ['po', '발주 · 입고'], ['restock', '재입고 판단']];
  $('#a-potabs').innerHTML = TB.map(([k, t]) => `<button type="button" data-potab="${k}" class="h-10 px-4 text-sm font-bold ${A.poTab === k ? 'border-b-2 border-neutral-900' : 'text-neutral-500'}">${t}</button>`).join('');
  const PST = { draft: `초안 ${HUMAN}`, confirmed: '발주 확정', inspect: `입고 검수 ${HUMAN}`, received: '입고 완료' }, d = today();
  const qOf = (p) => A.pos.filter((x) => x.pid === p.id && x.status !== 'draft').reduce((s, x) => s + x.qty, 0);
  if (A.poTab === 'sched') {
    const steps = (p) => [['예약 시작', p.preorder_start], ['예약 마감', p.preorder_end], ['발매', p.release], ['발송 시작', p.ship_start]];
    $('#a-po').innerHTML = products.filter((p) => p.sale_type === 'preorder').map((p) => { const r = reserved(p), q = qOf(p), pct = q ? Math.min(100, Math.round((r / q) * 100)) : 0; return `<div class="mb-3 rounded-lg border border-neutral-200 bg-white p-4">
      <p class="font-bold">${sku(p)} · ${esc(p.name_ko)}</p>
      <ol class="mt-3 grid grid-cols-4 text-[12px]">${steps(p).map(([k, v], i) => `<li class="${v.slice(0, 10) <= d ? 'text-neutral-400' : ''}"><div class="flex items-center"><span class="h-2.5 w-2.5 flex-none rounded-full ${v.slice(0, 10) <= d ? 'bg-neutral-300' : 'bg-neutral-900'}"></span>${i < 3 ? '<span class="h-0.5 flex-1 bg-neutral-300"></span>' : ''}</div><p class="mt-1">${k} ${v.slice(0, 10) <= d ? '(완료)' : ''}</p><p class="font-bold tabular-nums">${fmtDate(v).slice(5)}</p></li>`).join('')}</ol>
      <div class="mt-3 flex items-center gap-3 text-[13px]"><span class="whitespace-nowrap">예약 ${n(r)} / 발주 ${q ? n(q) : '미확정'}</span><div class="h-3 flex-1 overflow-hidden rounded-full bg-neutral-200"><div class="h-full bg-neutral-800" style="width:${pct}%"></div></div><b class="tabular-nums">${q ? pct + '%' : '-'}</b></div></div>`; }).join('') || '<p class="text-neutral-500">예약 상품 없음</p>';
  } else if (A.poTab === 'po') {
    $('#a-po').innerHTML = `<div class="overflow-x-auto"><table class="adm bg-white"><thead><tr><th>발주 번호</th><th>옵션 코드</th><th>발주 수량</th><th>발주일</th><th>입고 예정</th><th>리드타임</th><th>상태</th><th>입고 수량</th><th>불량</th><th>근거</th><th></th></tr></thead><tbody>${A.pos.map((x) => `<tr><td class="whitespace-nowrap">${x.id}</td><td class="whitespace-nowrap font-bold">${sku(P[x.pid], x.opt)}</td><td class="tabular-nums">${n(x.qty)}</td><td>${md(x.date)}</td><td>${md(x.eta)}</td><td>${P[x.pid].lead_days}일</td><td class="whitespace-nowrap">${PST[x.status]}</td>
      <td>${x.status === 'inspect' ? `<input type="number" min="0" data-inq="${x.id}" value="${x.qty}">` : x.inq !== undefined ? n(x.inq) : '-'}</td><td>${x.status === 'inspect' ? `<input type="number" min="0" data-inb="${x.id}" value="0">` : x.bad !== undefined ? n(x.bad) : '-'}</td>
      <td class="min-w-[180px] text-xs text-neutral-600">${esc(x.note)}</td>
      <td>${x.status === 'draft' ? `<button type="button" data-ap="po" data-id="${x.id}" class="btn btn-ink !h-10 !px-3 text-xs whitespace-nowrap">발주 확정</button>` : x.status === 'inspect' ? `<button type="button" data-ap="insp" data-id="${x.id}" class="btn btn-ink !h-10 !px-3 text-xs whitespace-nowrap">검수 승인</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  } else {
    const rs = products.filter((p) => status(p, S()) === 'soldout' || notifyOf(p).kr + notifyOf(p).intl > 0);
    $('#a-po').innerHTML = `<div class="overflow-x-auto"><table class="adm bg-white"><thead><tr><th>옵션 코드</th><th>상품</th><th>신청</th><th>국내</th><th>해외</th><th>가용</th><th>발주 참고(신청×전환율 ${Math.round(site.restock_conversion * 100)}%)</th><th>최소 발주</th><th>판단</th><th>알림</th></tr></thead><tbody>${rs.map((p) => { const x = notifyOf(p), t = x.kr + x.intl, ref = Math.ceil((t * site.restock_conversion) / 10) * 10, open = A.pos.find((y) => y.pid === p.id && y.status !== 'received');
      return `<tr><td class="font-bold">${sku(p)}</td><td class="min-w-[180px]">${esc(p.name_ko)}</td><td class="font-bold tabular-nums">${n(t)}</td><td class="tabular-nums">${n(x.kr)}</td><td class="tabular-nums">${n(x.intl)}</td><td class="tabular-nums">${n(total(p, S()))}</td><td class="tabular-nums">${n(ref)}</td><td class="tabular-nums">${n(p.moq)}</td><td class="whitespace-nowrap">${open ? '발주 진행 (' + open.id + ')' : ref >= p.moq ? '발주 제안' : '보류(미달)'}</td><td class="whitespace-nowrap">${A.sent[p.id] ? md(A.sent[p.id]) + ' 발송' : '입고 시 자동'}</td></tr>`; }).join('') || '<tr><td colspan="10" class="text-neutral-500">-</td></tr>'}</tbody></table></div>`;
  }
}

function cs() {
  const ST = { 접수: 'bg-rose-100 text-rose-700', '처리 중': 'bg-amber-100 text-amber-800', 완료: 'bg-neutral-200 text-neutral-600' };
  const byP = {}, byT = {}; A.cs.forEach((c) => { const k = sku(P[c.pid], c.opt); byP[k] = (byP[k] || 0) + 1; byT[c.type] = (byT[c.type] || 0) + 1; });
  const bad = A.cs.filter((c) => c.type.startsWith('불량')).reduce((m, c) => { const k = sku(P[c.pid], c.opt); m[k] = (m[k] || 0) + 1; return m; }, {});
  $('#a-cs').innerHTML = `<div class="space-y-3">${A.cs.map((c) => { const p = P[c.pid], late = c.st !== '완료' && c.at < dateOf(A.off - 1); return `<div class="rounded-lg border ${late ? 'border-rose-400' : 'border-neutral-200'} bg-white p-4">
      <div class="flex flex-wrap items-center gap-2 text-[13px]"><span class="rounded px-1.5 py-0.5 text-[11px] font-bold ${ST[c.st]}">${c.st}</span><b>${c.type}</b><span class="rounded border border-neutral-300 px-1.5 text-[11px]">${c.lang}</span>
        <span class="text-neutral-500">${c.id} · ${md(c.at)}${c.no ? ' · ' + c.no : ''} · ${sku(p, c.opt)} ${esc(p.name_ko)}</span>${late ? '<span class="text-[11px] font-bold text-rose-600">24시간 초과</span>' : ''}</div>
      <p class="mt-2 text-sm">${esc(c.q)}</p>
      ${c.st === '완료' ? `<p class="mt-2 rounded bg-neutral-100 p-2 text-[13px] text-neutral-700">${esc(c.ans)}</p>` : `<div class="mt-2 flex flex-wrap items-start gap-2">
        <select data-tpl="${c.id}" class="h-10 rounded border border-neutral-300 bg-white px-2 text-sm"><option value="">답변 템플릿</option>${Object.keys(TPL).map((k) => `<option ${k === c.type ? 'selected' : ''}>${k}</option>`).join('')}</select>
        <textarea data-ans="${c.id}" rows="2" class="min-h-10 flex-1 rounded border border-neutral-300 p-2 text-sm">${esc(c.ans || TPL[c.type] || '')}</textarea>
        ${c.st === '접수' ? `<button type="button" data-cs="ing" data-id="${c.id}" class="btn btn-line !h-10 !px-3 text-xs">처리 중</button>` : ''}
        ${c.type.startsWith('불량') && !c.ex ? `<button type="button" data-cs="ex" data-id="${c.id}" class="btn btn-line !h-10 !px-3 text-xs">교환 출고 생성</button>` : ''}
        <button type="button" data-cs="done" data-id="${c.id}" class="btn btn-ink !h-10 !px-3 text-xs">답변 등록</button></div>`}
    </div>`; }).join('')}</div>
    <div class="mt-6 grid gap-6 md:grid-cols-2">
      <div><h3 class="font-bold">유형별</h3><table class="adm mt-2 bg-white"><tbody>${Object.entries(byT).map(([k, v]) => `<tr><td>${k}</td><td class="text-right tabular-nums">${v}</td></tr>`).join('')}</tbody></table></div>
      <div><h3 class="font-bold">상품별</h3><table class="adm mt-2 bg-white"><tbody>${Object.entries(byP).map(([k, v]) => `<tr><td class="font-bold">${k}</td><td class="text-right tabular-nums">${v}${bad[k] ? ` <span class="ml-1 text-[11px] font-bold text-rose-600">불량 ${bad[k]}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
    </div>`;
}
function csAct(k, id) {
  const c = A.cs.find((x) => x.id === id), ta = $(`[data-ans="${id}"]`); if (ta) c.ans = ta.value.trim();
  if (k === 'ing') { c.st = '처리 중'; log('문의', `${id} 처리 중`); }
  if (k === 'ex') {
    const p = P[c.pid]; if (avail(p, c.opt) < 1) return toast('가용 재고가 없어 교환 출고를 만들 수 없습니다.');
    const no = `EX-${today().slice(5, 7)}${today().slice(8)}-${id.slice(3)}`;
    A.orders.push({ no, date: today(), country: 'KR', pid: c.pid, opt: c.opt, qty: 1, status: 'ready', tracking: '', flag: '', reason: '불량 교환' });
    setAvail(p, c.opt, avail(p, c.opt) - 1); A.defect[sku(p, c.opt)] = (A.defect[sku(p, c.opt)] || 0) + 1; c.ex = no; c.st = '처리 중';
    log('문의', `${id} 교환 출고 ${no} 생성 · 불량 재고 +1`); toast(`교환 출고 ${no}를 출고 준비에 등록했습니다.`);
  }
  if (k === 'done') { if (!c.ans) return toast('답변을 입력해 주십시오.'); c.st = '완료'; log('문의', `${id} 답변 등록 · 고객 알림 발송`); toast('답변을 등록했습니다.'); }
  persist(); paint(); render();
}

function banner() {
  const bs = S().banner || site.banners.map((b) => ({ ko: b.title_ko, en: b.title_en, on: 1, start: '', end: '' }));
  $('#a-banner').innerHTML = site.banners.map((b, i) => { const x = bs[i], src = DATA.bannerImg?.[i]; const pv = (cls) => `<div class="ph dark relative ${cls} overflow-hidden rounded bg-neutral-700"><span>${b.img}.jpg</span>${src ? `<img src="${src}" alt="">` : ''}</div>`;
    return `<div class="rounded-lg border border-neutral-200 bg-white p-4" data-b="${i}">
      <div class="flex flex-wrap items-center gap-2"><b class="mr-auto">배너 ${i + 1} · ${esc(b.label)}</b>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-bf="on" ${x.on ? 'checked' : ''} style="width:18px;height:18px"> 게시</label></div>
      <div class="mt-3 grid gap-4 md:grid-cols-[auto_1fr]">
        <div class="flex items-end gap-2"><div><p class="text-[11px] text-neutral-500">PC</p>${pv('h-24 w-44')}</div><div><p class="text-[11px] text-neutral-500">모바일 1:1</p>${pv('h-24 w-24')}</div></div>
        <div class="grid gap-2 md:grid-cols-2">
          <label class="text-xs text-neutral-600">문구(한국어)<input data-bf="ko" value="${esc(x.ko)}" class="mt-1 block h-10 w-full rounded border border-neutral-300 px-2 text-sm text-neutral-900"></label>
          <label class="text-xs text-neutral-600">문구(영어)<input data-bf="en" value="${esc(x.en)}" class="mt-1 block h-10 w-full rounded border border-neutral-300 px-2 text-sm text-neutral-900"></label>
          <label class="text-xs text-neutral-600">게시 시작(KST)<input data-bf="start" type="date" value="${x.start}" class="mt-1 block h-10 w-full rounded border border-neutral-300 px-2 text-sm text-neutral-900"></label>
          <label class="text-xs text-neutral-600">게시 종료(KST)<input data-bf="end" type="date" value="${x.end}" class="mt-1 block h-10 w-full rounded border border-neutral-300 px-2 text-sm text-neutral-900"></label>
          <p class="text-xs text-neutral-500 md:col-span-2">연결: ${esc(b.href)}</p></div></div></div>`; }).join('');
}
function saveBanner() {
  S().banner = [...document.querySelectorAll('[data-b]')].map((el) => { const g = (k) => el.querySelector(`[data-bf="${k}"]`); return { ko: g('ko').value.trim(), en: g('en').value.trim(), on: g('on').checked ? 1 : 0, start: g('start').value, end: g('end').value }; });
  persist(); toast('저장했습니다. 메인 배너에 반영됩니다.');
}

function settings() {
  $('#a-rules').innerHTML = `<div class="overflow-x-auto"><table class="adm bg-white"><thead><tr><th></th><th>조건</th><th>자동 실행</th><th>사용</th></tr></thead><tbody>${RULES.map(([k, c, a]) => `<tr><td class="font-bold">${k}</td><td>${c || '배송 완료 신호'}</td><td>${a}</td><td><input type="checkbox" data-rule="${k}" ${A.rules[k] ? 'checked' : ''} style="width:20px;height:20px"></td></tr>`).join('')}</tbody></table></div>`;
}

function render() {
  const v = view();
  document.querySelectorAll('[data-view]').forEach((s) => s.classList.toggle('hidden', s.dataset.view !== v));
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('bg-white', a.dataset.nav === v));
  const nb = { orders: approvals().length, cs: openCS().length };
  document.querySelectorAll('[data-badge]').forEach((b) => { const c = nb[b.dataset.badge] || 0; b.textContent = c; b.classList.toggle('hidden', !c); });
  $('#a-day').textContent = '데모 날짜 ' + today().replace(/-/g, '.');
  ({ dash, orders, stock, po, cs, banner, settings })[v]();
}
A = load();
if (!A.cs) Object.assign(A, { cs: seedCS(), plog: [], added: [], poTab: 'po', edit: null, tab: '' });
TABS.forEach((t) => $('#s-tab').insertAdjacentHTML('beforeend', `<option>${esc(t)}</option>`));
$('#s-tab').value = A.tab || '';
render();
addEventListener('hashchange', () => { scrollTo(0, 0); render(); });
const topBtn = $('#a-top');
const onScroll = () => { const end = scrollY > 200 && innerHeight + scrollY >= document.documentElement.scrollHeight - 40; topBtn.classList.toggle('opacity-0', !end); topBtn.classList.toggle('pointer-events-none', !end); };
addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll);

document.addEventListener('click', (e) => {
  const el = e.target.closest('button,[data-filter]'); if (!el) return;
  const id = el.id, ds = el.dataset;
  if (id === 'a-top') return scrollTo({ top: 0, behavior: 'smooth' });
  if (id === 'a-next') return advance();
  if (ds.ap) return approve(ds.ap, ds.id);
  if (ds.cs) return csAct(ds.cs, ds.id);
  if (ds.filter) { A.filter = ds.filter; persist(); return orders(); }
  if (ds.potab) { A.poTab = ds.potab; persist(); return po(); }
  if (ds.mv) return move(ds.mv, Number(ds.d));
  if (ds.ed) { A.edit = ds.ed; editForm(); return $('#a-edit').scrollIntoView({ block: 'start' }); }
  if (id === 'a-new') { A.edit = 'new'; return editForm(); }
  if (id === 'e-cancel') { A.edit = null; return editForm(); }
  if (id === 'e-save') return saveEdit(false);
  if (id === 'e-copy') return saveEdit(true);
  if (id === 'a-bsave') return saveBanner();
  if (id === 'a-reset') { try { localStorage.removeItem(KEY); } catch {} app.reset(); A = load(); persist(); paint(); render(); return toast('초기화했습니다.'); }
  if (id === 'a-down') return csvDown('stock.csv', [['code', 'id', 'option', 'available'], ...products.flatMap((p) => p.options.map((o, j) => [sku(p, j), p.id, o, avail(p, j)]))]);
  if (id === 'a-pick') { const l = A.orders.filter((o) => o.status === 'ready'); if (!l.length) return toast('출고 준비 주문이 없습니다.'); return csvDown(`picking_${today()}.csv`, [['no', 'country', 'code', 'product', 'qty', 'tracking'], ...l.map((o) => [o.no, o.country, sku(P[o.pid], o.opt), P[o.pid].name_ko, o.qty, ''])]); }
  if (id === 'a-podown') return csvDown(`po_${today()}.csv`, [['po', 'code', 'product', 'qty', 'order_date', 'eta', 'status', 'received', 'defect'], ...A.pos.map((x) => [x.id, sku(P[x.pid], x.opt), P[x.pid].name_ko, x.qty, x.date, x.eta, x.status, x.inq ?? '', x.bad ?? ''])]);
});
let dragId = null;
document.addEventListener('dragstart', (e) => { dragId = e.target.closest?.('[data-drag]')?.dataset.drag || null; });
document.addEventListener('dragover', (e) => { if (dragId && e.target.closest?.('[data-drag]')) e.preventDefault(); });
document.addEventListener('drop', (e) => { const t = e.target.closest?.('[data-drag]'); if (dragId && t && t.dataset.drag !== dragId) { e.preventDefault(); move(dragId, t.dataset.drag); } dragId = null; });
document.addEventListener('input', (e) => { if (['o-q', 'o-from', 'o-to'].includes(e.target.id)) olist(); });
document.addEventListener('change', (e) => {
  const el = e.target;
  const edit = (p, j, v, r) => { const a = avail(p, j); if (a === v) return; setAvail(p, j, v); A.slog.unshift({ t: stamp(), c: sku(p, j), a, b: v, r }); };
  if (el.dataset.tpl !== undefined) { const ta = $(`[data-ans="${el.dataset.tpl}"]`); if (ta && el.value) ta.value = TPL[el.value]; return; }
  if (el.id === 's-tab') { A.tab = el.value; persist(); return stock(); }
  if (el.dataset.rule) { A.rules[el.dataset.rule] = el.checked ? 1 : 0; persist(); return; }
  if (el.dataset.stock) { const j = Number(el.dataset.j); edit(P[el.dataset.stock], j, Math.max(0, Math.floor(Number(el.value) || 0)), $(`[data-rsn="${el.dataset.stock}-${j}"]`)?.value || '조정'); }
  else if (el.dataset.low) { S().low[el.dataset.low] = Math.max(0, Math.floor(Number(el.value) || 0)); }
  else if (el.id === 'a-track' && el.files[0]) {
    return el.files[0].text().then((txt) => {
      let ok = 0;
      txt.replace(/^﻿/, '').split(/\r?\n/).slice(1).forEach((line) => {
        const c = line.split(',').map((x) => (x || '').trim().replace(/^"|"$/g, '')), o = A.orders.find((x) => x.no === c[0] && x.status === 'ready'), t = c[c.length - 1];
        if (!o || !t) return; o.tracking = t; o.status = 'shipped'; ok++;
      });
      el.value = ''; if (ok) { log('송장', `송장 일괄 입력 ${ok}건 → 배송 중`); if (A.rules.R3) log('R3', `배송 알림 발송 ${ok}건 · 주소 변경 잠금`); }
      persist(); render(); toast(ok ? `송장 ${ok}건을 반영했습니다.` : 'CSV 형식을 확인해 주십시오. (피킹 리스트 마지막 칸에 송장 번호)');
    });
  } else if (el.id === 'a-up' && el.files[0]) {
    return el.files[0].text().then((txt) => {
      let ok = 0;
      txt.replace(/^﻿/, '').split(/\r?\n/).slice(1).forEach((line) => {
        const c = line.split(',').map((x) => (x || '').trim().replace(/^"|"$/g, '')), p = P[c[1]], v = c[c.length - 1];
        if (!p || v === '' || isNaN(v)) return;
        edit(p, Math.max(0, p.options.indexOf(c[2])), Math.max(0, Math.floor(Number(v))), 'CSV 올리기'); ok++;
      });
      el.value = ''; ruleR5(); persist(); paint(); render(); toast(ok ? 'CSV를 반영했습니다.' : 'CSV 형식을 확인해 주십시오. (code,id,option,available)');
    });
  } else return;
  ruleR5(); persist(); paint(); setTimeout(render);
});
