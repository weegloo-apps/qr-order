# 작은 테이블 · QR 테이블 오더 — 소스코드

[English](README.md)

Weegloo 마켓플레이스 앱 **작은 테이블 QR 오더**의 소스코드입니다. 마켓에서 앱을 설치한 매장이 카드 결제를
자기 가게가 계약한 PG로 바꾸거나 화면을 고칠 수 있도록 공개합니다.

손님은 테이블 QR을 찍어 로그인 없이 메뉴를 보고 주문합니다. 사장님은 Weegloo 계정으로 `/admin`에 로그인해
주문을 처리하고, 메뉴와 매장 설정을 바꾸고, 매출을 봅니다.

> ⚠️ **설치한 그대로의 카드 결제는 Stripe 테스트 모드입니다.** 실제로 청구되지 않고 테스트 카드로만 결제가
> 됩니다. 실제로 카드 결제를 받으려면 아래 [다른 PG로 바꾸기](#다른-pg로-바꾸기)를 따라 바꾸세요. 바꾸기 전에는
> 매장 설정 → 주문 설정에서 **'주문할 때 결제'를 끄고** 카운터에서 결제받으세요.

## 들어 있는 것

| 경로 | 내용 |
|---|---|
| `site/` | 손님 화면과 사장님 화면. 빌드 단계 없는 정적 사이트(ES 모듈)이고, 모든 자산 경로는 `/`로 시작합니다. Weegloo 웹호스팅(SPA 모드)에 그대로 올립니다. |
| `weegloo/scripts/` | 서버에서 도는 Weegloo Script 5개: `place-order`, `confirm-payment`, `refund-order`, `order-status`, `staff-call` |
| `weegloo/content-types/` | 데이터 구조: 매장 설정(`store`), 메뉴 섹션(`section`), 메뉴(`item`), 주문(`order`), 직원 호출(`call`), 주문 카운터(`counter`) |
| `weegloo/space-role.customer.json` | 손님 화면 토큰에 묶인 역할(읽기 범위와 실행할 수 있는 Script) |

`weegloo/` 아래 파일은 설치된 Space의 리소스를 그대로 옮긴 참고용 정의입니다. 마켓에서 설치하면 같은 리소스가
이미 만들어져 있으니, 바꿀 때는 Weegloo 콘솔에서 내 Space의 해당 리소스를 고치면 됩니다.

## 먼저: 자리표시자를 내 값으로

이 소스에는 특정 Space의 값이 들어 있지 않습니다. 대신 `__SPACE_ID__` 같은 자리표시자가 있습니다.

- **`site/js/config.js`** — 가장 쉬운 방법은 설치된 내 사이트의 설정 파일을 그대로 가져오는 것입니다.
  브라우저로 `https://<내 사이트 주소>/js/config.js`를 열어 내용을 복사해 이 파일을 덮어쓰세요.
  설치할 때 내 Space의 값으로 바뀐 파일입니다.
- **`site/index.html`** — `og:image`, `twitter:image`의 `https://YOUR-SUBDOMAIN.weegloo.app`을 내 사이트 주소로 바꿉니다.
- **`weegloo/scripts/*.json`** — Script를 이 파일로 새로 만들거나 덮어쓸 때만 아래 표의 값으로 바꿉니다.

| 자리표시자 | `config.js` 키 | 뜻 |
|---|---|---|
| `__SPACE_ID__` | `spaceId` | Space id |
| `__CUSTOMER_TOKEN__` | `customerToken` | 손님 화면용 Space Access Token (공개되는 값) |
| `__STORE_ID__` | `storeId` | 매장 설정 항목(한 건) id |
| `__COUNTER_ID__` | `counterId` | 주문 카운터 항목(한 건) id |
| `__CT_STORE__` … `__CT_COUNTER__` | `contentTypes.store` … `contentTypes.counter` | ContentType id |
| `__SCRIPT_PLACE_ORDER__` … `__SCRIPT_REFUND_ORDER__` | `scripts.placeOrder` … `scripts.refundOrder` | Script id |
| `__GOOGLE_MAPS_EMBED_KEY__` | `mapsEmbedKey` | 가게 정보 화면 지도(Google Maps Embed API) 키 |

> 결제 후 돌아올 주소(`success_url`, `cancel_url`)는 따로 정하지 않습니다. `place-order`가 주문을 보낸 사이트의 주소로 만들기 때문에
> 설치된 주소든 연결한 도메인이든 그대로 쓰입니다. 2026년 10월 29일 전에 설치했다면 내 Space의 `place-order`에 두 주소가 다른 사이트 주소로
> 고정되어 있을 수 있습니다. `weegloo/scripts/place-order.json`처럼 `{ /headers/origin }`으로 시작하도록 고쳐 주세요.

## 구조

| 호출자 | API | 자격 증명 |
|---|---|---|
| 손님: 매장·메뉴 읽기 | CDA (게시본만) | `customerToken` — 매장/섹션/메뉴 읽기와 손님용 Script 4개 실행만 가능 |
| 손님: 주문·결제 확인·주문 상태·직원 호출 | Script `/execute` | 같은 토큰 |
| 사장님: 모든 관리 | CMA (+ `refund-order` Script) | Weegloo 콘솔 로그인 팝업 토큰, 이 Space의 멤버만 |

- **금액은 서버가 정합니다.** `place-order`가 게시된 메뉴 가격과 옵션 가격으로 합계를 계산해 주문 행(`total`)에 저장합니다. 화면이 보낸 금액은 쓰지 않습니다.
- **결제 여부도 서버가 정합니다.** `confirm-payment`가 PG에 직접 물어보고, 결제 완료·주문 id·금액이 모두 맞을 때만 주문을 확정합니다. 결제 후 돌아온 주소만으로는 아무것도 확정되지 않습니다.
- 주문은 게시하지 않으므로 CDA로 보이지 않습니다. 손님은 자기 기기에 저장된 주문 id로 `order-status`를 통해서만 상태를 봅니다.

## 지금의 결제 흐름 (Stripe Checkout)

매장 설정의 **주문할 때 결제**(`store.prepay`)가 켜져 있을 때:

1. 장바구니에서 주문하면 `place-order`가 금액을 계산하고, 주문을 `status: pending`, `payment: pending`으로 저장한 뒤 Stripe Checkout 세션을 만들어 `{ pay: { orderId, url } }`를 돌려줍니다. `pending` 주문은 사장님 화면에 보이지 않습니다.
   결제 후 돌아올 주소는 요청의 `Origin` 헤더(주문을 보낸 사이트 주소)로 만듭니다. 이 헤더가 없거나 사이트 주소 형식이 아니면 주문을 만들지 않고 `bad-origin`으로 거절합니다.
2. 화면(`site/js/customer/views.js`의 `place()`)은 주문 id를 기기에 기억해 두고(`addPendingPay`) Stripe 결제 페이지로 이동합니다.
3. 결제가 끝나면 Stripe가 `success_url`(`/paid/{주문 id}`)로 돌려보냅니다. 이 화면(`paidScreen()`)이 `confirm-payment`를 부릅니다.
4. `confirm-payment`는 Stripe 세션을 조회해 `payment_status: paid`, `client_reference_id`(= 주문 id), `amount_total`(= 주문의 `total`)이 모두 맞을 때만 주문 번호(매일 `A-001`부터)를 붙이고 `status: new`, `payment: paid`로 바꿉니다. 이때 사장님 화면에 알림이 울립니다. 주문 행은 `sys.version` 잠금으로 고쳐서 두 번 확정되지 않습니다.
5. 결제를 취소하면 `cancel_url`(`/cart?pay=cancel&order=…`)로 돌아오고 장바구니는 그대로입니다.
6. 사장님이 결제된 주문을 거절하거나 환불하면 `refund-order`가 Stripe에 환불을 요청하고(`Idempotency-Key`로 중복 환불 방지), 받아들여진 뒤에만 주문을 `rejected`(완료된 주문은 `done` 유지) · `payment: refunded`로 바꿉니다.

**주문할 때 결제**가 꺼져 있으면 `place-order`가 PG를 부르지 않고 바로 주문 번호를 붙여 `new`로 저장합니다(카운터 결제).

## 다른 PG로 바꾸기

### 바꿀 곳

**서버 (Weegloo Script)** — 콘솔 → Script에서 내 Space의 Script를 고칩니다.

| Script | 지금 | 바꿀 것 |
|---|---|---|
| `place-order` | `prepay`일 때 `pending` 주문을 만들고 Stripe Checkout 세션 생성 | `pending` 주문까지는 그대로 두고, Stripe 호출(`Http`) 부분만 PG에 맞게 바꿉니다. 결제창 주소를 서버에서 만드는 PG면 그 주소를 `pay.url`로 돌려주고(돌아올 주소는 지금처럼 `{ /headers/origin }`으로 만듭니다), 브라우저 SDK로 결제창을 여는 PG(토스페이먼츠 등)면 PG 호출을 빼고 `{ pay: { orderId, amount, orderName } }`만 돌려줍니다. |
| `confirm-payment` | Stripe 세션 조회 후 확정 | PG의 승인·조회 API로 결제를 확인합니다. 금액은 **주문 행의 `total`**과 비교합니다. PG가 돌려준 값(예: `paymentKey`)을 받아야 하면 `payloadSchema`에 추가합니다. |
| `refund-order` | Stripe 환불 API | PG의 취소(환불) API |

- 비밀 키는 Script의 **시크릿**(`definition.secrets`)에만 넣습니다. 지금은 `STRIPE_SECRET_KEY`이고, 이 저장소의 파일에서는 값이 비어 있습니다. 브라우저 코드(`site/`)에 넣으면 누구나 볼 수 있습니다.
- 주문의 `stripeSessionId`, `paymentIntentId`, `refundId` 필드(RichText)는 Script만 씁니다. PG의 결제 키를 `paymentIntentId`에 그대로 담아도 되고, 필드를 새로 추가해도 됩니다. 사이트 코드는 이 필드를 읽지 않습니다.

**화면 (`site/`)**

| 파일 | 고칠 곳 |
|---|---|
| `js/customer/views.js` | `place()`: `place-order` 응답의 `res.pay`를 받아 결제로 넘어가는 부분. 브라우저 SDK형 PG는 여기서 결제창을 엽니다. `stripeLocale()` / `STRIPE_LOCALES`: Stripe 결제창 언어(필요 없으면 삭제). `testCardNote()`: 테스트 카드 안내(삭제). `paidScreen()`: `/paid/{주문 id}`에서 `confirm-payment`를 부르는 부분 — PG가 돌려준 쿼리 값을 함께 넘기도록 고칩니다. |
| `js/customer/state.js` | `confirmPayment()`, 결제 화면이 닫혀 돌아오지 못한 주문을 다음에 메뉴를 열 때 확인하는 `recoverPayments()` |
| `js/config.js` | `TEST_CARD` 삭제 |
| `js/i18n.js` | `s.t.prepayTest` 등 Stripe가 들어간 문구 |
| `index.html` | 브라우저 SDK형 PG면 SDK `<script>` 태그 추가 |

### 꼭 지킬 것

- 결제할 금액은 `place-order`가 계산해 주문 행에 저장한 `total`만 믿습니다. 화면이나 돌아온 주소의 금액은 비교에 쓰지 않습니다.
- 주문 확정은 `confirm-payment`가 PG API에 직접 확인한 결과로만 합니다.
- 이미 확정된 주문(`status`가 `pending`이 아님)은 다시 확정하지 않고, 주문 행은 `sys.version`을 붙여 고칩니다. 지금 Script의 구조를 그대로 두면 됩니다.
- 손님 토큰의 역할(`weegloo/space-role.customer.json`)에 주문 쓰기 권한을 주지 마세요. 손님이 주문 금액이나 상태를 직접 쓸 수 있게 됩니다.
- Script 읽기 권한이 있으면 시크릿 값이 보입니다. Script 읽기는 관리자에게만 주세요.
- 실제 결제를 받기 전에 PG의 테스트 키로 주문 → 결제 → 확정 → 환불까지 끝까지 시험하세요.

### 예: 토스페이먼츠

토스페이먼츠는 브라우저 SDK로 결제창을 열고, 돌아온 뒤 서버가 **승인 API**를 불러야 결제가 끝나는 방식입니다.
정확한 API와 키는 [토스페이먼츠 개발자센터](https://docs.tosspayments.com)를 따르세요.

1. **`place-order`**: `prepay` 분기에서 Stripe `Http`와 `stripeSessionId` 저장을 빼고, `pending` 주문을 만든 뒤
   `{ ok: true, pay: { orderId: <주문 id>, amount: <total>, orderName: <매장 이름 · 테이블> } }`를 돌려줍니다.
   Weegloo 주문 id(영문·숫자 30자)는 토스의 `orderId` 규칙(6–64자, 영문·숫자·`-`·`_`)에 맞습니다.
2. **화면**: `index.html`에 토스 SDK를 추가하고, `place()`에서 `res.pay`로 결제를 요청합니다.
   `successUrl`은 `${location.origin}/paid/${orderId}`, `failUrl`은 `${location.origin}/cart?pay=cancel&order=${orderId}`로 둡니다.
3. **돌아온 화면**: 토스는 `successUrl`에 `paymentKey`, `orderId`, `amount`를 붙여 돌려보냅니다. `paidScreen()`이
   `confirm-payment`에 `{ orderId, paymentKey }`를 넘기게 하고, `payloadSchema`에도 `paymentKey`를 추가합니다.
   쿼리의 `amount`는 서버에서 쓰지 않습니다.
4. **`confirm-payment`**: Stripe 조회 대신
   - `POST https://api.tosspayments.com/v1/payments/confirm`(본문 `paymentKey`, `orderId`, `amount` = **주문의 `total`**)로 승인하고,
   - `GET https://api.tosspayments.com/v1/payments/{paymentKey}`로 다시 조회해 `status: DONE`, `orderId`, `totalAmount`가 주문과 맞을 때만 확정합니다. 승인 응답이 중간에 끊겨도 조회 결과로 판단할 수 있습니다. `IN_PROGRESS`면 잠시 뒤 다시 확인하도록 `503`을 돌려줍니다.
   - 인증 헤더는 `Authorization: Basic <base64("시크릿키:")>`입니다(끝의 `:` 포함). Script에서는 base64를 만들 수 없으니 미리 인코딩한 값을 시크릿(예: `TOSS_BASIC_AUTH`)에 넣고 `Basic { /secrets/TOSS_BASIC_AUTH }`로 씁니다.
   - 확정할 때 `paymentKey`를 주문에 저장합니다(환불에 필요).
   - 토스는 결제 요청 후 **10분 안에** 승인해야 합니다. 결제 화면이 닫혀 돌아오지 못한 주문은 `paymentKey`가 없어 나중에 승인할 수 없고, 승인되지 않은 결제는 청구되지 않습니다.
5. **`refund-order`**: `POST https://api.tosspayments.com/v1/payments/{paymentKey}/cancel`(본문 `cancelReason`)로 취소합니다. 중복 취소를 막으려면 `Idempotency-Key` 헤더를 붙입니다.
6. 토스페이먼츠는 원화(KRW) 결제입니다. 매장 설정의 통화를 KRW로 두세요.

### Stripe를 그대로 쓰는 경우

내 Stripe 계정의 비밀 키(제한 키 `rk_live_…` 권장)를 세 Script의 `STRIPE_SECRET_KEY` 시크릿에 넣고,
`TEST_CARD`와 테스트 카드 안내(`testCardNote()`)를 지운 뒤, Stripe의 go-live 체크리스트를 진행하세요.
결제 직후 손님이 화면을 닫는 경우까지 확실히 잡으려면 Stripe 웹훅(`checkout.session.completed`)을 받는
Script를 추가하는 것이 좋습니다.

## 배포

1. `site/`의 **내용**을 ZIP으로 묶습니다(ZIP 맨 위에 `index.html`).
2. Weegloo 콘솔 → 웹호스팅 → 내 사이트에서 새 ZIP으로 업데이트합니다. SPA 모드를 유지하세요(`/t/3`, `/paid/…` 같은 주소를 `index.html`이 처리합니다).

> 마켓에서 설치한 웹호스팅에 ZIP을 새로 올리면, 콘솔에서 제목·설명·공유 이미지 같은 페이지 메타를 고치는 기능은 더
> 이상 쓸 수 없습니다. 그 뒤로는 `site/index.html`의 `<head>`를 직접 고쳐 배포하세요.

## 알아 둘 것

- **시간대**: 시각은 UTC로 저장하고, 화면은 매장 시간대로 보여 줍니다. 관리자 화면을 처음 열면 그 기기의 시간대(`store.timeZone`, 예: `Asia/Seoul`)와 지금의 UTC 차이(분, `store.utcOffsetMin`)를 매장 정보에 저장합니다. 시간대는 그 뒤로 바뀌지 않고, UTC 차이는 서머타임이 바뀐 뒤 관리자 화면을 열면 다시 저장됩니다. Script는 시간대를 변환할 수 없어서 `place-order`와 `confirm-payment`는 `utcOffsetMin`으로 영업 시간, 라스트 오더, 주문이 속한 날(`businessDay`, 매일 `A-001`부터 시작하는 주문 번호)을 정합니다. 값이 아직 없으면 한국 시간(`32400000`, 9시간)을 씁니다. 2026년 10월 29일 전에 설치했다면 내 Space에는 두 필드와 이 로직이 없어 한국 시간 그대로입니다. `weegloo/content-types/store.json`의 두 필드를 추가하고, 두 Script의 `32400000`을 `weegloo/scripts/`처럼 바꿔 주세요.
- **기본 로케일**: Script는 언어와 상관없는 값을 `en-US`에서 읽고 씁니다. Space의 기본 로케일이 `en-US`라고 가정합니다.
- **화면 문구**: `site/js/i18n.js`의 영어·한국어 사전입니다. 언어 목록은 Space의 Locale을 따릅니다.
- **사용량**: 손님 화면은 주문을 보고 있는 동안 10초마다(최대 1시간) `order-status`를 부르고, 이는 Weegloo Script 실행 횟수에 포함됩니다.
