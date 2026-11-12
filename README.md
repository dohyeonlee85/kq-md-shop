# KQ MD SHOP 데모 (지원용 콘셉트 목업)

Astro + Tailwind + Swiper 정적 사이트. Cloudflare Pages 배포. 결제 기능 없음, 검색 노출 차단(noindex·robots.txt·X-Robots-Tag).

## 내용 수정 (파일 교체만으로 전 화면 반영)

| 바꿀 것 | 파일 | 방법 |
|---|---|---|
| 상품 데이터(이름·가격·재고·일정·구성 등) | `src/data/products.csv` | 엑셀·구글 시트로 열어 수정 후 CSV(UTF-8) 저장 |
| 한/영 문구(버튼·안내·FAQ·사업자 정보 등) | `src/data/copy.csv` | `key`는 그대로, `ko`·`en` 칸만 수정 |
| 배너·시즌 칩·아티스트 소개·시나리오·기준일 | `src/data/site.json` | 값만 수정 (`today` = 데모 안 "오늘" 고정 날짜) |
| 사진 | `public/images/{banner,poster,product,scenario}/` | 회색 상자에 적힌 파일명 그대로 넣기 (jpg·png·webp) |

- `products.csv` 규칙: `options`·`stock`은 `|`로 구분(예: `A ver.|B ver.` / `820|640`), 날짜는 `2027-01-10 23:59`(KST), `sale_type`은 `preorder` 또는 `regular`, `intl_ship` 0 = 국내 전용.
- 상태 딱지는 재고에서 자동 계산: 재고 0 = SOLD OUT, 예약 상품 = PRE-ORDER, 재고 ≤ `low_stock_at` = LOW STOCK.
- 아티스트 구역 배경색은 `poster/{artist}_poster.jpg`에서 빌드 시 자동 추출(사진 없으면 회색).
- 관리자 데모(`/admin/`) 입력값은 보는 사람 브라우저에만 저장, 매일 초기화.

## 사진 파일명

`banner/ateez_banner1~3.jpg` · `poster/ateez_poster.jpg` · `product/ateez_01~08_main.jpg` · `product/ateez_01~08_detail1~2.jpg` · `scenario/s1_1~s3_4.jpg`

## Cloudflare Pages 설정

- Framework preset: Astro / Build command: `npm run build` / Output directory: `dist`
- Production branch: `main`

## 로컬 실행

```
npm install
npm run dev
```
