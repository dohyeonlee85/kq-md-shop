// 브라우저 공통: 언어·국가, 데모 상태(이 브라우저에만 저장·매일 초기화), 헤더·메뉴, 카드·구매 영역 갱신
import { makeT, sortProducts, cardHTML, buyHTML, badges, status, stocks, total, dual, esc } from './logic.js';

export const DATA = JSON.parse(document.getElementById('__data').textContent);
export const { products, site } = DATA;
export const T = makeT(DATA.copy);
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ── 데모 상태
const KEY = 'kq_demo_v1';
const day = () => new Date().toLocaleDateString('sv');
export function load() {
  try { const s = JSON.parse(ls.get(KEY)); if (s && s.day === day()) return s; } catch {}
  return { day: day(), stock: {}, low: {}, order: [], notify: {}, memo: {}, clicks: { banner: 0, poster: 0 }, cart: 0 };
}
export let state = load();
export const save = () => ls.set(KEY, JSON.stringify(state));
export const reset = () => { try { localStorage.removeItem(KEY); } catch {} state = load(); };

// ── 언어·국가
const country = () => site.countries.find((c) => c.code === document.documentElement.dataset.country) || site.countries[0];
export function setLang(l) { document.documentElement.lang = l; ls.set('kq_lang', l); paintRegion(); }
export function setCountry(code) {
  const h = document.documentElement;
  h.dataset.country = code; h.dataset.region = code === 'KR' ? 'KR' : 'INTL';
  ls.set('kq_country', code); paintRegion();
}
function paintRegion() {
  const c = country(), en = document.documentElement.lang === 'en';
  $$('[data-country-name]').forEach((e) => (e.innerHTML = dual(c.ko, c.en)));
  $$('[data-lang-name]').forEach((e) => (e.textContent = en ? 'English' : '한국어'));
  $$('[data-cur]').forEach((e) => (e.textContent = c.code === 'KR' ? 'KRW' : 'USD'));
  $$('[data-set-country]').forEach((e) => e.classList.toggle('font-bold', e.dataset.setCountry === c.code));
  $$('[data-set-lang]').forEach((e) => e.classList.toggle('font-bold', e.dataset.setLang === document.documentElement.lang));
  // 특전 마감 현지 시각 (해외 국가 선택 시)
  $$('[data-localtime]').forEach((e) => {
    const d = new Date(e.dataset.localtime);
    e.textContent = new Intl.DateTimeFormat(en ? 'en-US' : 'ko-KR', { timeZone: c.tz, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(d);
  });
}

// ── 알림 글자
let toastTimer;
export function toast(html) {
  const t = $('#toast'); t.innerHTML = html; t.classList.remove('opacity-0', 'pointer-events-none');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none'), 3200);
}

// ── 화면 갱신 (관리자 입력 → 메인·샵·상세 반영)
export function paint() {
  $$('[data-grid]').forEach((g) => {
    const list = sortProducts(products.filter((p) => p.artist === g.dataset.grid), state);
    const n = Number(g.dataset.limit || list.length);
    g.innerHTML = list.slice(0, n).map((p) => cardHTML(p, state, T, site.today)).join('');
  });
  const d = $('[data-detail]');
  if (d) {
    const p = products.find((x) => x.id === d.dataset.detail);
    $('#badges').innerHTML = badges(p, state, T);
    $('#buy').innerHTML = buyHTML(p, state, T);
    $('#sticky-btn').innerHTML = $('#buybtn').innerHTML;
  }
  $$('[data-cart]').forEach((e) => { e.textContent = state.cart; e.classList.toggle('hidden', !state.cart); });
  document.dispatchEvent(new CustomEvent('kq:paint'));
}

function init() {
  paintRegion(); paint();
  // 헤더: 첫 화면 배너 위 투명 → 스크롤 시 흰 헤더
  const hdr = $('#hdr');
  const onScroll = () => hdr.classList.toggle('is-solid', !hdr.dataset.overlay || scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  // 상세 하단 고정 버튼
  const bar = $('#sticky');
  if (bar) new IntersectionObserver(([e]) => bar.classList.toggle('translate-y-full', e.isIntersecting || e.boundingClientRect.top > 0), { threshold: 0 }).observe($('#buy'));
  // 모바일 하단 접기
  if (innerWidth < 768) $$('footer details').forEach((d) => d.removeAttribute('open'));

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act],[data-open],[data-set-lang],[data-set-country],[data-click]');
    $$('.dd').forEach((d) => { if (!el || el.dataset.open !== d.id) d.classList.add('hidden'); });
    if (!el) return;
    if (el.dataset.click) { state.clicks[el.dataset.click]++; save(); }
    if (el.dataset.open) { const t = $('#' + el.dataset.open); t.classList.toggle('hidden'); if (t.id === 'menu') document.body.classList.toggle('overflow-hidden', !t.classList.contains('hidden')); return; }
    if (el.dataset.setLang) return setLang(el.dataset.setLang);
    if (el.dataset.setCountry) return setCountry(el.dataset.setCountry);
    const act = el.dataset.act, d = $('[data-detail]'), p = d && products.find((x) => x.id === d.dataset.detail);
    if (act === 'top') scrollTo({ top: 0, behavior: 'smooth' });
    if (act === 'cartview') toast(T('toast.cartview'));
    if (act === 'qty') {
      const q = $('#qty'), opt = Number($('#opt')?.value || 0);
      const max = Math.min(p.limit_per_account || 99, stocks(p, state)[opt]);
      const n = Number(q.textContent) + Number(el.dataset.d);
      if (n > max) toast(T('toast.limit')); else if (n >= 1) q.textContent = n;
    }
    if (act === 'buy') { state.cart += Number($('#qty')?.textContent || 1); save(); paint(); toast(T('toast.cart')); }
    if (act === 'notify') { state.notify[p.id] = (state.notify[p.id] || 0) + 1; save(); toast(T('toast.notify')); }
  });
  document.addEventListener('change', (ev) => { if (ev.target.id === 'opt') $('#qty').textContent = 1; });

  // 메뉴 안 상품 검색
  const q = $('#q');
  q?.addEventListener('input', () => {
    const v = q.value.trim().toLowerCase(), out = $('#q-out');
    if (!v) return (out.innerHTML = '');
    const hit = products.filter((p) => (p.name_ko + ' ' + p.name_en + ' ' + p.tab).toLowerCase().includes(v));
    out.innerHTML = hit.length ? hit.map((p) => `<a class="block py-2 border-b border-neutral-100" href="/product/${p.id}/">${dual(p.name_ko, p.name_en)}</a>`).join('') : `<p class="py-2 text-neutral-500">${T('nav.noresult')}</p>`;
  });
}
init();
export { total, status, stocks, esc, dual };
