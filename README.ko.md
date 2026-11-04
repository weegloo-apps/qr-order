# 작은 테이블 · QR 테이블 오더 — 소스코드

[English](README.md)

Weegloo 마켓플레이스 앱 **작은 테이블 QR 오더**의 소스코드입니다. 마켓에서 앱을 설치한 매장이 카드 결제를
자기 가게가 계약한 PG로 바꾸거나 화면을 고칠 수 있도록 공개합니다.

손님은 테이블 QR을 찍어 로그인 없이 메뉴를 보고 주문합니다. 사장님은 Weegloo 계정으로 `/admin`에 로그인해
주문을 처리하고, 메뉴와 매장 설정을 바꾸고, 매출을 봅니다.

> ⚠️ **설치한 그대로의 카드 결제는 Stripe 테스트 모드입니다.** 실제로 청구되지 않고 테스트 카드로만 결제가
> 됩니다. 실제로 카드 결제를 받으려면 아래 [다른 PG로 바꾸기](#다른-pg로-바꾸기)를 따라 바꾸세요. 바꾸기 전에는
> 매장 설정 → 주문 설정에서 **'주문할 때 결제'를 끄고** 카운터에서 결제받으세요.

> ⚠️ **기본 언어가 English(en-US)인 Space에 설치하세요.** 기본 언어가 다르면 주문이 들어가지 않고, 관리자 화면이
> 바꾸는 방법을 안내합니다([알아 둘 것](#알아-둘-것)의 기본 로케일).

## 들어 있는 것

| 경로 | 내용 |
|---|---|
| `site/` | 손님 화면과 사장님 화면. 빌드 단계 없는 정적 사이트(ES 모듈)이고, 모든 자산 경로는 `/`로 시작합니다. Weegloo 웹호스팅(SPA 모드)에 그대로 올립니다. |
| `weegloo/scripts/` | 서버에서 도는 Weegloo Script 6개: `place-order`, `start-checkout`, `confirm-payment`, `refund-order`, `order-status`, `staff-call` |
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

> 결제 후 돌아올 주소(`success_url`, `cancel_url`)는 따로 정하지 않습니다. `start-checkout`이 주문을 보낸 사이트의 주소로 만들기 때문에
> 설치된 주소든 연결한 도메인이든 그대로 쓰입니다. 내 Space에 `start-checkout` Script가 없다면(이전 설치) `place-order`가 Stripe 세션을
> 직접 만들고, 2026년 10월 29일 전 설치라면 그 두 주소가 다른 사이트 주소로 고정되어 있을 수도 있습니다. 지금의 Script로 옮기면 둘 다
> 해결됩니다([이전 설치 업데이트](#이전-설치-업데이트) 참고).

## 구조

| 호출자 | API | 자격 증명 |
|---|---|---|
| 손님: 매장·메뉴 읽기 | CDA (게시본만) | `customerToken` — 매장/섹션/메뉴 읽기와 손님용 Script 5개 실행만 가능 |
| 손님: 주문·결제 시작·결제 확인·주문 상태·직원 호출 | Script `/execute` | 같은 토큰 |
| 사장님: 모든 관리 | CMA (+ `refund-order` Script) | Weegloo 콘솔 로그인 팝업 토큰, 이 Space의 멤버만 |

- **금액은 서버가 정합니다.** `place-order`가 게시된 메뉴 가격과 옵션 가격으로 합계를 계산해 주문 행(`total`)에 저장합니다. 화면이 보낸 금액은 쓰지 않습니다.
- **결제 여부도 서버가 정합니다.** `confirm-payment`가 PG에 직접 물어보고, 결제 완료·주문 id·금액이 모두 맞을 때만 주문을 확정합니다. 결제 후 돌아온 주소만으로는 아무것도 확정되지 않습니다.
- 주문은 게시하지 않으므로 CDA로 보이지 않습니다. 손님은 자기 기기에 저장된 주문 id로 `order-status`를 통해서만 상태를 봅니다.

## 지금의 결제 흐름 (Stripe Checkout)

매장 설정의 **주문할 때 결제**(`store.prepay`)가 켜져 있을 때:

1. 장바구니에서 주문하면 `place-order`가 금액을 계산하고, 주문을 `status: pending`, `payment: pending`으로 저장한 뒤 `{ prepay: true, order: { id, … } }`를 돌려줍니다. `pending` 주문은 사장님 화면에 보이지 않습니다.
2. 화면(`site/js/customer/views.js`의 `place()`)이 이어서 그 주문 id로 `start-checkout`을 부릅니다. 이 Script는 주문에 저장된 금액으로 Stripe Checkout 세션을 만들어 `{ pay: { orderId, url } }`를 돌려줍니다. 주문마다 한 번만(먼저 `sys.version` 잠금으로 주문에 표시), 주문 후 30분 안에만 만듭니다.
   결제 후 돌아올 주소는 요청의 `Origin` 헤더(주문을 보낸 사이트 주소)로 만듭니다. 이 헤더가 없거나 사이트 주소 형식이 아니면 `bad-origin`으로 거절하고, 주문은 보이지 않는 `pending`으로 남습니다.
3. 화면은 주문 id를 기기에 기억해 두고(`addPendingPay`) Stripe 결제 페이지로 이동합니다.
4. 결제가 끝나면 Stripe가 `success_url`(`/paid/{주문 id}`)로 돌려보냅니다. 이 화면(`paidScreen()`)이 `confirm-payment`를 부릅니다.
5. `confirm-payment`는 Stripe 세션을 조회해 `payment_status: paid`, `client_reference_id`(= 주문 id), `amount_total`(= 주문의 `total`)이 모두 맞을 때만 주문 번호(매일 `A-001`부터)를 붙이고 `status: new`, `payment: paid`로 바꿉니다. 이때 사장님 화면에 알림이 울립니다. 주문 행은 `sys.version` 잠금으로 고쳐서 두 번 확정되지 않습니다.
6. 결제를 취소하면 `cancel_url`(`/cart?pay=cancel&order=…`)로 돌아오고 장바구니는 그대로입니다.
7. 사장님이 결제된 주문을 거절하거나 환불하면 `refund-order`가 Stripe에 환불을 요청하고(`Idempotency-Key`로 중복 환불 방지), 받아들여진 뒤에만 주문을 `rejected`(완료된 주문은 `done` 유지) · `payment: refunded`로 바꿉니다.

**주문할 때 결제**가 꺼져 있으면 `place-order`가 바로 주문 번호를 붙여 `new`로 저장하고(카운터 결제), 화면은 `start-checkout`을 부르지 않습니다. `place-order`는 어느 경우에도 PG를 부르지 않습니다.

## 다른 PG로 바꾸기

실제 카드 결제를 받으려면 결제를 내 가게가 계약한 PG로 바꿔야 합니다. 코드를 직접 고칠 필요 없이 AI 에이전트에게 말로
맡기면 됩니다. 에이전트가 이 저장소의 코드로 결제 부분을 바꾸고, 내 Space의 서버 기능(Script)을 고치고, 사이트를 내
웹호스팅에 다시 올립니다. 마켓에서 설치한 사이트 파일은 그 자리에서 고칠 수 없어서 이 저장소의 코드를 받아 씁니다.

### 준비할 것

- **PG 계약과 키**: PG와 계약하고, PG 관리자 화면에서 **테스트 키**와 **실제 키**를 받아 둡니다. 키는 보통 공개해도
  되는 키(클라이언트 키)와 절대 공개하면 안 되는 비밀 키(시크릿 키)가 한 쌍입니다.
- **AI 에이전트**: Claude Code, Codex, Cursor 같은 AI 에이전트에 [Weegloo 문서 — 연결하기](https://docs.weegloo.com/ai/tools/connect)를
  따라 Weegloo를 연결합니다. 로그인은 QR 오더를 설치한 Space에 관리자로 들어갈 수 있는 Weegloo 계정으로 합니다.
- **내 사이트 주소**: 손님이 테이블 QR로 들어오는 주소입니다(예: `https://내가게.weegloo.app`).

### 바꾸는 순서

1. **바꿀 수 있는지 먼저 묻기**: PG마다 연동 방식이 달라서, 이 앱에서는 쓸 수 없거나 Weegloo 유료 요금제가 필요한 PG도
   있습니다([Weegloo Free 플랜](#weegloo-free-플랜) 참고). 먼저 이렇게 물어보세요.

   ```text
   https://github.com/weegloo-apps/qr-order 의 결제를 [PG 이름]으로 바꿀 수 있는지 확인해줘.
   ```

   안 된다고 하면 그 PG가 다른 연동 방식을 제공하는지 PG에 문의해 보세요.
2. **바꿔 달라고 요청하기**:

   ```text
   https://github.com/weegloo-apps/qr-order 를 내려받아서 결제 시스템을 [PG 이름] 결제로 변경하여 배포해줘.
   내 사이트 주소는 [내 사이트 주소]야.
   ```

   작업할 Space를 물으면 QR 오더를 설치한 Space를 고릅니다. 키를 물으면 먼저 **테스트 키**를 줍니다.
3. **시험 결제 해 보기**: 배포가 끝나면 휴대폰으로 테이블 QR을 찍어 아래를 확인합니다. 테스트 키로는 실제로 돈이 나가지 않습니다.
   - 결제하면 주문 완료 화면과 주문 번호가 나온다.
   - 사장님 화면(`/admin`)에 주문이 들어오고 알림이 울린다.
   - 결제 창에서 취소하면 장바구니로 돌아오고, 사장님 화면에 주문이 생기지 않는다.
   - 사장님 화면에서 환불하면 PG 관리자 화면에서도 취소로 바뀐다.
   - PG 관리자 화면의 결제 금액이 주문 금액과 같다.

   이상한 점이 있으면 본 그대로 에이전트에게 말하면 고쳐 줍니다.
4. **실제 키로 바꾸기**: "실제 키로 바꿔서 배포해줘"라고 요청하고 실제 키를 줍니다. 그 뒤 적은 금액으로 한 번 결제하고
   환불해 봅니다.
5. **마지막으로 확인하기**: 에이전트에게 아래 두 가지를 물어봅니다.
   - "비밀 키가 사이트 파일에 들어가지 않았는지 확인해줘." 사이트 파일은 누구나 볼 수 있어서, 비밀 키는 서버 기능(Script)에만
     있어야 합니다.
   - "결제 금액과 결제 완료 여부를 서버에서 PG에 직접 확인하는지 확인해줘." 손님 화면이 보낸 값을 그대로 믿으면 금액을 속일
     수 있습니다.

### 바꿀 때 알아 둘 것

- 매장 설정의 통화를 PG가 받는 통화로 맞추세요.
- 사이트를 다시 올리면 콘솔에서 사이트 제목·설명·공유 이미지를 바꾸는 기능은 더 이상 쓸 수 없습니다. 지금 값은 에이전트가
  새 사이트로 옮겨 주고(내 사이트 주소를 알려 준 경우), 그 뒤로 바꿀 때도 에이전트에게 요청하면 됩니다.

### Stripe를 그대로 쓰는 경우

Stripe 계정이 있다면 PG를 바꾸지 않고 내 Stripe 계정으로 실제 결제를 받을 수 있습니다. 에이전트에게 "결제를 내 Stripe
계정의 실제 결제로 바꿔서 배포해줘"라고 요청하고 Stripe의 비밀 키를 줍니다. Stripe 관리자 화면에서 권한을 줄인 제한
키(`rk_live_…`)를 만들어 주는 것이 안전합니다. 결제 직후 손님이 화면을 닫아도 주문이 확정되게 하려면 "Stripe 웹훅도 받게
해줘"라고 함께 요청하세요. Stripe 관리자 화면에서 할 일은 에이전트가 알려 줍니다. 그 뒤 위의 4·5단계처럼 적은 금액으로
결제와 환불을 해 보고 마지막 확인을 합니다.

## Weegloo Free 플랜

QR 주문은 Weegloo Free 플랜에서 돌아갑니다. 한도는 조직 전체 기준이고 조직의 모든 Space가 나눠 씁니다.

- **Script 크기**: Script 하나에 문장 30개까지(안쪽 문장 포함). 여기 Script는 place-order 29, confirm-payment 29,
  start-checkout 23, staff-call 21, refund-order 18, order-status 15개입니다. 결제 시작을 따로 떼어 낸 이유입니다.
  Script를 고칠 때도 30개를 넘지 않게 하세요.
- **Script 개수**: 조직의 10개 중 6개를 씁니다.
- **Script 실행**: 월 10,000회. 다 쓰면 다음 달이나 요금제를 올릴 때까지 조직의 모든 Script가 막혀 손님이 주문할 수 없습니다.
  주문 1건에 `place-order` 1회(주문할 때 결제면 `start-checkout`·`confirm-payment` 1회씩 더), 직원 호출 1건에 1회, 손님이
  주문 화면을 보고 있는 동안 20초마다 `order-status` 1회(최대 1시간)가 듭니다. 10분 동안 화면을 보면 주문 1건에 약 33회로,
  한 달 약 300건입니다. 주문이 많은 매장은 유료 요금제가 필요합니다(Basic: 월 100,000회, Script당 문장 50개).
- **콘텐츠**: 주문과 직원 호출은 지우지 않고 쌓이며 콘텐츠 한도(20,000개)에 포함됩니다.

### 이전 설치 업데이트

내 Space에 `start-checkout` Script가 없다면 `place-order`가 Stripe 세션을 직접 만들고, Free 플랜의 문장 30개를 넘습니다.
지금의 Script로 옮기려면:

1. `weegloo/scripts/start-checkout.json`으로 Script를 만들고(위 표처럼 자리 표시 값을 바꿔서), `STRIPE_SECRET_KEY` 시크릿에
   내 Stripe 비밀 키를 넣습니다.
2. `weegloo/space-role.customer.json`처럼 손님 역할의 Script `Execute` 목록에 추가합니다.
3. 그 id를 `site/js/config.js`의 `scripts.startCheckout`에 넣고 사이트를 배포합니다(아래). 화면은 이전 `place-order`와 새
   `place-order`를 모두 처리하므로 단계 사이에 깨지지 않습니다.
4. `place-order`와 `confirm-payment`를 `weegloo/scripts/`의 파일로 덮어씁니다(자리 표시 값 바꿔서). 파일의 시크릿은 비어 있으니
   `confirm-payment`의 `STRIPE_SECRET_KEY`에 Stripe 비밀 키를 다시 넣습니다.

**자정을 넘기는 영업 시간 (2026년 11월 수정).** 이전 버전은 그날 요일의 영업 시간만 봤습니다. 그래서 자정을 넘기는 날
(18:00 – 02:00)은 자정 이후 영업 종료로, 저녁에 여는 날은 자정 직후 영업 중으로 잘못 판단했습니다. 그 전에 설치했다면
`place-order`를 `weegloo/scripts/place-order.json`(자리 표시 값을 바꿔서)으로 덮어쓰고 **사이트도 함께** 배포하세요. 화면과
Script가 같이 바뀌어야 둘의 판단이 어긋나지 않습니다. 새 `place-order`는 매장 테이블 수보다 큰 테이블 번호도 거절하고
(`table-unknown`), 새 `start-checkout`은 결제 후 돌아올 주소로 https 사이트만 받습니다.

## 배포

1. `site/`의 **내용**을 ZIP으로 묶습니다(ZIP 맨 위에 `index.html`).
2. Weegloo 콘솔 → 웹호스팅 → 내 사이트에서 새 ZIP으로 업데이트합니다. SPA 모드를 유지하세요(`/t/3`, `/paid/…` 같은 주소를 `index.html`이 처리합니다).

> 마켓에서 설치한 웹호스팅에 ZIP을 새로 올리면, 콘솔에서 제목·설명·공유 이미지 같은 페이지 메타를 고치는 기능은 더
> 이상 쓸 수 없습니다. 그 뒤로는 `site/index.html`의 `<head>`를 직접 고쳐 배포하세요.

## 알아 둘 것

- **시간대**: 시각은 UTC로 저장하고, 화면은 매장 시간대로 보여 줍니다. 관리자 화면을 처음 열면 그 기기의 시간대(`store.timeZone`, 예: `Asia/Seoul`)와 지금의 UTC 차이(분, `store.utcOffsetMin`)를 매장 정보에 저장합니다. 시간대는 그 뒤로 바뀌지 않고, UTC 차이는 서머타임이 바뀐 뒤 관리자 화면을 열면 다시 저장됩니다. Script는 시간대를 변환할 수 없어서 `place-order`와 `confirm-payment`는 `utcOffsetMin`으로 영업 시간, 라스트 오더, 주문이 속한 날(`businessDay`, 매일 `A-001`부터 시작하는 주문 번호)을 정합니다. 값이 아직 없으면 한국 시간(`32400000`, 9시간)을 씁니다. 2026년 10월 29일 전에 설치했다면 내 Space에는 두 필드와 이 로직이 없어 한국 시간 그대로입니다. `weegloo/content-types/store.json`의 두 필드를 추가하고, 두 Script의 `32400000`을 `weegloo/scripts/`처럼 바꿔 주세요.
- **영업 시간**: 요일마다 영업 시간이 하나씩 있습니다(`store.hours`의 `from`–`to`). 종료 시간이 시작 시간과 같거나 이르면 자정을 넘겨 다음 날까지 이어집니다. 금요일 18:00 – 02:00이면 토요일 02:00에서 라스트 오더 시간을 뺀 때까지 주문을 받습니다. 자정 이후에는 화면(`site/js/hours.js`의 `currentSessions()`)과 `place-order`가 전날 영업이 아직 이어지는지 먼저 보고, 그다음 그날 영업을 봅니다. 저녁에 여는 날의 새벽은 영업이 아니므로, 수요일이 쉬는 날이면 목요일 18:00 – 02:00이어도 목요일 0시 55분은 영업 전입니다. 매출 집계와 주문 번호(`A-001`부터)의 영업일은 지금처럼 매장 시간대의 자정에 바뀌어, 자정을 넘긴 주문은 다음 날로 셉니다.
- **기본 로케일**: Script는 언어와 상관없는 값(가격, 영업 시간, 주문)을 `en-US`에서 읽고 쓰므로, Space의 기본 로케일이 `en-US`여야 합니다. 설치해도 Space의 원래 기본 로케일은 바뀌지 않습니다. 기본 로케일이 다른 언어인 Space에서는 주문과 직원 호출이 모두 거절되고(`locale en-US is not allowed for this field`), 기본 언어 화면에서는 이 값들이 빈 값으로 읽힙니다. 두 화면이 이를 확인합니다(`site/js/i18n.js`의 `localeReady()`). 손님 화면은 "아직 주문을 받을 준비가 안 됐어요"를 보여 주고, 관리자 화면은 아무것도 읽거나 저장하기 전에 멈추고 고치는 방법을 안내합니다. Weegloo 콘솔에서 Space 설정 → Locale 관리를 열고, English (United States)를 기본 Locale로 정한 뒤 다른 언어의 Fallback Locale을 English (United States)로 바꾸세요.
- **화면 문구(10개 언어)**: 영어 · 한국어 · 일본어 · 중국어(간체) · 독일어 · 프랑스어 · 스페인어 · 포르투갈어 · 힌디어 · 인도네시아어. 영어 원문은 `site/js/i18n.js`의 `EN` 사전이고, 나머지 아홉 언어는 `site/i18n/<언어>.js`(`ko`, `ja`, `zh`, `de`, `fr`, `es`, `pt`, `hi`, `id`)에 있어 그 언어를 쓸 때만 내려받습니다. 키나 값이 빠지면 영어 문구가 나옵니다.
  - 언어 목록은 Space의 Locale을 따르고, Locale은 언어 부분으로 사전을 고릅니다(`ja-JP` → `ja`, `pt-BR` → `pt`). 사전이 없는 언어(예: `nl`)와 번체 중국어(`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant…`)는 문구가 영어로, 콘텐츠는 그 언어로 보입니다. 다른 언어를 쓰려면 Space에 Locale을 추가하세요.
  - 숫자 · 날짜 · 통화 형식(`Intl`), Stripe 결제 화면 언어, 지도 언어도 화면 문구의 언어를 따르고, 사전이 없는 언어는 영어(`en-US`) 형식입니다. Stripe에 없는 힌디어는 Stripe가 브라우저 언어로 고릅니다(`auto`). 일본어 · 중국어 화면은 한자가 한국어 글꼴(Noto Sans KR)로 그려지지 않도록 시스템 글꼴을 씁니다.
  - 관리자 화면도 같은 언어 선택을 따릅니다(입력 언어 탭과는 별개). 메뉴 편집의 옵션 프리셋(온도 · 사이즈 · 추가 옵션) 이름도 10개 언어로 `site/js/admin/menu.js`에 있습니다.
  - 템플릿: `{name}`은 값, `{n#단수/복수}`는 n이 1이면 앞쪽, `{name~을/를}`은 한국어 전용 조사입니다. 언어를 추가하려면 `site/i18n/ko.js`를 복사해 값만 번역하고(키와 `{…}` 이름은 그대로), `site/js/i18n.js`의 `PRESETS`와 `admin/menu.js`의 프리셋 이름에 언어 코드를 넣습니다.
  - 영어 · 한국어 외 여덟 언어는 기계 번역입니다. 실제 매장에 쓰기 전에 원어민 검토를 권합니다. "Powered by Weegloo"는 번역하지 않습니다.
- **사용량**: 손님 화면은 주문을 보고 있는 동안 20초마다(최대 1시간) `order-status`를 부르고, 이는 Weegloo Script 실행 횟수에 포함됩니다([Weegloo Free 플랜](#weegloo-free-플랜) 참고).
