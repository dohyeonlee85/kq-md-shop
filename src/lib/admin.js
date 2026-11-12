// 관리자 데모: 가공 주문(orders.csv) 1개를 원본으로 전 화면 숫자 계산. 이 브라우저에만 저장·매일 초기화.
// 단계 이동 규칙은 이 파일 advance() 1곳에만 있음.
import * as app from './app.js';
import { DATA, products, site, save, paint, toast } from './app.js';
import { status, stocks, total, lowAt, statusChip, sku, esc, fmtDate } from './logic.js';

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
  ['R4', '배송 완료 신호', '수령 처리'],
  ['R5', '가용 재고 ≤ LOW 기준', '발주서 초안 생성(최근 7일 판매량 기준)'],
  ['R6', '입고 검수 승인', '가용 재고 전환 · 품절 해제 · 재입고 알림 발송'],
  ['R7', '수령 다음 날', '정산 집계(매출 · 환불)'],
];
const STAGE = { pay: '결제 확인', ready: '출고 준비', shipped: '배송 중', delivered: '수령', closed: '정산 완료', reserved: '예약 할당', return_req: '교환·반품 접수', returned: '교환·반품 완료' };

function fresh() {
  return { day: realDay(), off: 0, orders: DATA.orders.map((o) => ({ ...o })), pos: site.pos.map((x) => ({ ...x })), log: [], slog: [], rules: Object.fromEntries(RULES.map((r) => [r[0], 1])), defect: {}, preAdd: {}, sent: {}, seq: 0, filter: 'all' };
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
    x.status = 'received'; x.done = today(); setAvail(p, x.opt, avail(p, x.opt) + x.qty);
    log('승인', `${id} 검수 승인`);
    if (A.rules.R6) {
      const nt = notifyOf(p), wake = A.orders.filter((o) => o.pid === p.id && o.status === 'reserved');
      wake.forEach((o) => { setAvail(p, o.opt, avail(p, o.opt) - o.qty); o.status = 'ready'; });
      log('R6', `${sku(p, x.opt)} 가용 +${n(x.qty)}${was <= 0 ? ' · 품절 해제' : ''}${nt.kr + nt.intl ? ` · 재입고 알림 ${n(nt.kr + nt.intl)}명 발송` : ''}${wake.length ? ` · 예약 주문 ${wake.length}건 출고 준비` : ''}`);
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
const tile = (k, v, sub = '') => `<div class="rounded-lg border border-neutral-200 bg-white p-4"><p class="text-xs text-neutral-500">${k}</p><p class="mt-1 text-2xl font-black tabular-nums">${v}</p><p class="mt-1 text-[11px] text-neutral-500">${sub || '&nbsp;'}</p></div>`;
const count = (s) => A.orders.filter((o) => o.status === s).length;

function dash() {
  const d = today(), from = dateOf(A.off - 6), ap = approvals();
  const tod = A.orders.filter((o) => o.date === d), kr = tod.filter((o) => o.country === 'KR').length;
  const wk = A.orders.filter((o) => o.date >= from && !['reserved', 'returned'].includes(o.status));
  const rev = wk.reduce((s, o) => s + o.qty * P[o.pid].price_krw, 0), wkr = wk.filter((o) => o.country === 'KR').length;
  const pre = products.filter((p) => p.sale_type === 'preorder');
  const dep = pre.reduce((s, p) => s + reserved(p) * p.price_krw, 0);
  const low = products.filter((p) => status(p, S()) === 'low').length, so = products.filter((p) => status(p, S()) === 'soldout').length;
  const series = [...Array(7)].map((_, i) => A.orders.filter((o) => o.date === dateOf(A.off - 6 + i)).length), mx = Math.max(...series, 1);
  const nt = products.map(notifyOf).reduce((s, x) => s + x.kr + x.intl, 0), cl = S().clicks;
  const by = (k) => ap.filter((x) => x.k === k).length;
  $('#a-dash').innerHTML = `
    <div class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-[13px]"><b class="text-rose-700">사람 승인 대기 ${ap.length}건</b>
      <span class="ml-2 text-rose-700">이상 주문 ${by('hold')} · 발주 확정 ${by('po')} · 입고 검수 ${by('insp')} · 교환·반품 ${by('ret')}</span> <a href="#flow" class="ml-2 underline">처리하기</a></div>
    <div class="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      ${tile('오늘 주문 (' + md(d) + ')', n(tod.length), `국내 ${kr} · 해외 ${tod.length - kr}`)}
      ${tile('최근 7일 매출', won(rev), `결제 완료 기준 · 국내 ${wk.length ? Math.round((wkr / wk.length) * 100) : 0}% : 해외 ${wk.length ? 100 - Math.round((wkr / wk.length) * 100) : 0}%`)}
      ${tile('예약 선수금', won(dep), '발송 시 매출 인식(일반 기준 예시)')}
      ${tile('LOW STOCK / SOLD OUT', `${low} / ${so}`, '가용 재고 기준')}
      ${tile('자동 처리 비율', Math.round((1 - ap.length / (A.orders.length + A.pos.length)) * 100) + '%', `전체 ${A.orders.length + A.pos.length}건 중 승인 대기 ${ap.length}건`)}
    </div>
    <div class="mt-3 rounded-lg border border-neutral-200 bg-white p-4"><p class="text-xs text-neutral-500">최근 7일 주문 건수 (${md(from)} ~ ${md(d)})</p>
      <svg viewBox="-2 -2 104 36" preserveAspectRatio="none" class="mt-2 h-20 w-full"><polyline points="${series.map((v, i) => `${(i * 100) / 6},${30 - (v / mx) * 26}`).join(' ')}" fill="none" stroke="#111" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>
      <p class="flex justify-between text-[11px] tabular-nums text-neutral-500">${series.map((v) => `<span>${v}</span>`).join('')}</p></div>
    <p class="mt-2 text-xs text-neutral-500">배너 클릭 ${n(site.clicks.banner + cl.banner)} · 포스터 예약 클릭 ${n(site.clicks.poster + cl.poster)} · 재입고 알림 신청 ${n(nt)}</p>`;
}

function flow() {
  const ap = approvals();
  const step = (k, s, tags, sub) => `<button type="button" data-filter="${s}" class="min-w-[120px] flex-1 rounded-lg border p-3 text-left ${A.filter === s ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white'}"><p class="text-xs">${k}</p><p class="text-2xl font-black tabular-nums">${count(s)}</p><p class="mt-1 flex flex-wrap gap-1">${tags}</p><p class="mt-1 text-[11px] opacity-70">${sub}</p></button>`;
  const list = A.orders.filter((o) => A.filter === 'all' || o.status === A.filter).sort((a, b) => b.no.localeCompare(a.no)).slice(0, 40);
  $('#a-flow').innerHTML = `
    <div class="flex flex-wrap items-center gap-2"><span class="rounded bg-neutral-900 px-2 py-1 text-xs font-bold text-white">데모 날짜 ${today().replace(/-/g, '.')}</span>
      <button type="button" id="a-next" class="btn btn-ink !h-10 !px-4 text-sm">하루 진행 ▶</button>
      <span class="text-xs text-neutral-500">누르면 자동 처리분이 다음 단계로 이동, 승인 필요 건만 아래 "사람 승인 대기"에 남음</span></div>
    <div class="mt-3 flex gap-2 overflow-x-auto pb-1">
      ${step('① 결제 확인', 'pay', AUTO + HUMAN, '이상 주문만 사람 확인')}${step('② 출고 준비', 'ready', AUTO + PHYS, '피킹 리스트·송장 자동 / 포장')}
      ${step('③ 배송 중', 'shipped', AUTO, '알림 발송·주소 잠금')}${step('④ 수령', 'delivered', AUTO, '배송 완료 신호')}${step('⑤ 정산 완료', 'closed', AUTO, '매출·환불 집계')}
    </div>
    <div class="mt-2 flex gap-2 overflow-x-auto pb-1">
      ${step('예약 할당 (입고 대기)', 'reserved', AUTO, '입고 검수 승인 시 출고 준비')}${step('교환·반품 접수', 'return_req', HUMAN, '반품 승인')}${step('교환·반품 완료', 'returned', AUTO, '재고·환불 반영')}
      <button type="button" data-filter="all" class="min-w-[120px] flex-1 rounded-lg border p-3 text-left ${A.filter === 'all' ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 bg-white'}"><p class="text-xs">전체 주문</p><p class="text-2xl font-black tabular-nums">${A.orders.length}</p></button>
    </div>
    <h3 class="mt-6 font-bold">사람 승인 대기 ${ap.length}건</h3>
    <div class="mt-2 overflow-x-auto"><table class="adm bg-white"><tbody>${ap.map((x) => `<tr><td class="whitespace-nowrap font-bold">${x.t}</td><td>${esc(x.d)}</td><td class="text-right"><button type="button" data-ap="${x.k}" data-id="${x.id}" class="btn btn-ink !h-8 !px-3 text-xs">승인</button></td></tr>`).join('') || '<tr><td class="text-neutral-500">승인 대기 없음</td></tr>'}</tbody></table></div>
    <h3 class="mt-6 font-bold">주문 표 <span class="text-xs font-normal text-neutral-500">${A.filter === 'all' ? '전체' : STAGE[A.filter]} · 최근 40건 표시</span></h3>
    <div class="mt-2 max-h-[360px] overflow-auto"><table class="adm bg-white"><thead><tr><th>주문번호</th><th>주문일</th><th>국가</th><th>옵션 코드</th><th>상품</th><th>수량</th><th>단계</th><th>송장</th></tr></thead><tbody>${list.map((o) => `<tr><td class="whitespace-nowrap tabular-nums">${o.no}</td><td>${md(o.date)}</td><td>${o.country}</td><td class="whitespace-nowrap">${sku(P[o.pid], o.opt)}</td><td class="min-w-[160px]">${esc(P[o.pid].name_ko)}</td><td>${o.qty}</td><td class="whitespace-nowrap">${STAGE[o.status]}${o.flag ? ' ' + HUMAN : ''}</td><td class="whitespace-nowrap tabular-nums">${o.tracking || '-'}</td></tr>`).join('')}</tbody></table></div>
    <div class="mt-6 grid gap-6 xl:grid-cols-2">
      <div><h3 class="font-bold">자동화 규칙</h3><div class="mt-2 overflow-x-auto"><table class="adm bg-white"><thead><tr><th></th><th>조건</th><th>자동 실행</th><th>사용</th></tr></thead><tbody>${RULES.map(([k, c, a]) => `<tr><td class="font-bold">${k}</td><td>${c}</td><td>${a}</td><td><input type="checkbox" data-rule="${k}" ${A.rules[k] ? 'checked' : ''} style="width:18px;height:18px"></td></tr>`).join('')}</tbody></table></div></div>
      <div><h3 class="font-bold">자동 처리 기록 <span class="text-xs font-normal text-neutral-500">최근 12건</span></h3><div class="mt-2 overflow-x-auto"><table class="adm bg-white"><thead><tr><th>일자</th><th>규칙</th><th>처리 내용</th></tr></thead><tbody>${A.log.slice(0, 12).map((l) => `<tr><td class="whitespace-nowrap">${md(l.d)}</td><td class="whitespace-nowrap font-bold">${l.rule}</td><td>${esc(l.text)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-neutral-500">[하루 진행]을 누르면 기록이 쌓입니다.</td></tr>'}</tbody></table></div></div>
    </div>`;
}

function stockTable() {
  $('#a-stock').innerHTML = `<table class="adm bg-white"><thead><tr><th>옵션 코드</th><th>상품 · 옵션</th><th>가용</th><th>예약 할당</th><th>출고 대기</th><th>불량</th><th>LOW 기준</th><th>상태(자동)</th></tr></thead><tbody>${products.map((p) => p.options.map((o, j) => `<tr>
      <td class="whitespace-nowrap font-bold">${sku(p, j)}</td><td class="min-w-[200px]">${esc(p.name_ko)}${o ? ' · ' + esc(o) : ''}<br><span class="text-xs text-neutral-500">${esc(p.tab)}</span></td>
      <td><input type="number" min="0" inputmode="numeric" data-stock="${p.id}" data-j="${j}" value="${avail(p, j)}"></td>
      <td class="tabular-nums">${j === 0 && p.sale_type === 'preorder' ? n(reserved(p)) : j ? '' : '0'}</td><td class="tabular-nums">${n(waiting(p, j))}</td><td class="tabular-nums">${A.defect[sku(p, j)] || 0}</td>
      ${j ? '<td></td><td></td>' : `<td><input type="number" min="0" inputmode="numeric" data-low="${p.id}" value="${lowAt(p, S())}"></td><td>${statusChip(status(p, S())) || '<span class="text-xs text-neutral-500">ON SALE</span>'}</td>`}</tr>`).join('')).join('')}</tbody></table>`;
  $('#a-slog').innerHTML = A.slog.slice(0, 5).map((l) => `<tr><td class="whitespace-nowrap">${l.t}</td><td class="font-bold">${l.c}</td><td>${l.a} → ${l.b}</td><td>${l.r}</td></tr>`).join('') || '<tr><td colspan="4" class="text-neutral-500">가용 재고를 수정하면 기록이 남습니다.</td></tr>';
}

function po() {
  const PST = { draft: `초안 ${HUMAN}`, confirmed: '발주 확정', inspect: `입고 검수 대기 ${HUMAN}`, received: '입고 완료' };
  const pre = products.filter((p) => p.sale_type === 'preorder'), d = today();
  const steps = (p) => [['예약 시작', p.preorder_start], ['예약 마감', p.preorder_end], ['발매', p.release], ['발송 시작', p.ship_start]];
  const ordered = (p) => A.pos.filter((x) => x.pid === p.id && x.status !== 'draft').reduce((s, x) => s + x.qty, 0);
  const rs = products.filter((p) => status(p, S()) === 'soldout' || notifyOf(p).kr + notifyOf(p).intl > 0);
  $('#a-po').innerHTML = `
    ${pre.map((p) => { const r = reserved(p), q = ordered(p), pct = q ? Math.min(100, Math.round((r / q) * 100)) : 0; return `<div class="mb-3 rounded-lg border border-neutral-200 bg-white p-4">
      <p class="font-bold">${sku(p)} · ${esc(p.name_ko)}</p>
      <ol class="mt-3 grid grid-cols-4 text-[12px]">${steps(p).map(([k, v], i) => `<li class="${v.slice(0, 10) <= d ? 'text-neutral-400' : ''}"><div class="flex items-center"><span class="h-2.5 w-2.5 flex-none rounded-full ${v.slice(0, 10) <= d ? 'bg-neutral-300' : 'bg-neutral-900'}"></span>${i < 3 ? '<span class="h-0.5 flex-1 bg-neutral-300"></span>' : ''}</div><p class="mt-1">${k} ${v.slice(0, 10) <= d ? '(완료)' : ''}</p><p class="font-bold tabular-nums">${fmtDate(v).slice(5)}</p></li>`).join('')}</ol>
      <div class="mt-3 flex items-center gap-3 text-[13px]"><span class="whitespace-nowrap">예약 ${n(r)} / 발주 ${q ? n(q) : '미확정'}</span><div class="h-3 flex-1 overflow-hidden rounded-full bg-neutral-200"><div class="h-full bg-neutral-800" style="width:${pct}%"></div></div><b class="tabular-nums">${q ? pct + '%' : '-'}</b></div></div>`; }).join('')}
    <h3 class="mt-6 font-bold">발주 · 입고</h3>
    <div class="mt-2 overflow-x-auto"><table class="adm bg-white"><thead><tr><th>발주 번호</th><th>옵션 코드</th><th>수량</th><th>발주일</th><th>입고 예정</th><th>리드타임</th><th>상태</th><th>근거</th><th></th></tr></thead><tbody>${A.pos.map((x) => `<tr><td class="whitespace-nowrap">${x.id}</td><td class="whitespace-nowrap font-bold">${sku(P[x.pid], x.opt)}</td><td class="tabular-nums">${n(x.qty)}</td><td>${md(x.date)}</td><td>${md(x.eta)}</td><td>${P[x.pid].lead_days}일</td><td class="whitespace-nowrap">${PST[x.status]}</td><td class="min-w-[200px] text-xs text-neutral-600">${esc(x.note)}</td>
      <td>${x.status === 'draft' ? `<button type="button" data-ap="po" data-id="${x.id}" class="btn btn-ink !h-8 !px-3 text-xs whitespace-nowrap">발주 확정</button>` : x.status === 'inspect' ? `<button type="button" data-ap="insp" data-id="${x.id}" class="btn btn-ink !h-8 !px-3 text-xs whitespace-nowrap">검수 승인</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <h3 class="mt-6 font-bold">재입고 알림 → 발주 판단</h3>
    <p class="mt-1 text-xs text-neutral-500">발주 참고 = 신청 수 × 재입고 후 구매 전환율 ${Math.round(site.restock_conversion * 100)}%(추정). 최소 발주 수량 미달이면 자동 제안 보류.</p>
    <div class="mt-2 overflow-x-auto"><table class="adm bg-white"><thead><tr><th>옵션 코드</th><th>상품</th><th>신청</th><th>국내</th><th>해외</th><th>가용</th><th>발주 참고</th><th>최소 발주</th><th>판단</th><th>알림</th></tr></thead><tbody>${rs.map((p) => { const x = notifyOf(p), t = x.kr + x.intl, ref = Math.ceil((t * site.restock_conversion) / 10) * 10, open = A.pos.find((y) => y.pid === p.id && y.status !== 'received');
      return `<tr><td class="font-bold">${sku(p)}</td><td class="min-w-[180px]">${esc(p.name_ko)}</td><td class="font-bold tabular-nums">${n(t)}</td><td class="tabular-nums">${n(x.kr)}</td><td class="tabular-nums">${n(x.intl)}</td><td class="tabular-nums">${n(total(p, S()))}</td><td class="tabular-nums">${n(ref)}</td><td class="tabular-nums">${n(p.moq)}</td><td class="whitespace-nowrap">${open ? '발주 진행 (' + open.id + ')' : ref >= p.moq ? '발주 제안' : '보류(미달)'}</td><td class="whitespace-nowrap">${A.sent[p.id] ? md(A.sent[p.id]) + ' 발송' : '입고 시 자동'}</td></tr>`; }).join('') || '<tr><td colspan="10" class="text-neutral-500">-</td></tr>'}</tbody></table></div>`;
}

function render() { dash(); flow(); stockTable(); po(); }
A = load();
render();

document.addEventListener('click', (e) => {
  const el = e.target.closest('#a-next,#a-reset,#a-down,[data-ap],[data-filter]'); if (!el) return;
  if (el.id === 'a-next') return advance();
  if (el.dataset.ap) return approve(el.dataset.ap, el.dataset.id);
  if (el.dataset.filter) { A.filter = el.dataset.filter; persist(); return flow(); }
  if (el.id === 'a-reset') { try { localStorage.removeItem(KEY); } catch {} app.reset(); A = load(); persist(); paint(); render(); toast('초기화했습니다.'); }
  if (el.id === 'a-down') {
    const rows = ['code,id,option,available', ...products.flatMap((p) => p.options.map((o, j) => `${sku(p, j)},${p.id},${o},${avail(p, j)}`))];
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' })); a.download = 'stock.csv'; a.click();
  }
});
document.addEventListener('change', (e) => {
  const el = e.target, stamp = () => new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).slice(5, 16);
  const edit = (p, j, v, r) => { const a = avail(p, j); if (a === v) return; setAvail(p, j, v); A.slog.unshift({ t: stamp(), c: sku(p, j), a, b: v, r }); };
  if (el.dataset.rule) { A.rules[el.dataset.rule] = el.checked ? 1 : 0; persist(); return; }
  if (el.dataset.stock) { edit(P[el.dataset.stock], Number(el.dataset.j), Math.max(0, Math.floor(Number(el.value) || 0)), $('#a-reason').value); }
  else if (el.dataset.low) { S().low[el.dataset.low] = Math.max(0, Math.floor(Number(el.value) || 0)); }
  else if (el.id === 'a-up' && el.files[0]) {
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
