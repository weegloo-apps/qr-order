# Small Table · QR Table Ordering — source code

[한국어](README.ko.md)

Source code of the Weegloo Marketplace app **Small Table QR Order**. It is public so that a shop that installed the
app can switch card payments to its own payment provider (PG) or change the screens.

Guests scan the QR on their table and order without signing in. The owner signs in at `/admin` with a Weegloo
account to handle orders, edit the menu and store settings, and see sales.

> ⚠️ **As installed, card payment runs in Stripe test mode.** Nothing is charged and only test cards go through.
> To take real card payments, switch it as described in [Switching to another payment provider](#switching-to-another-payment-provider).
> Until then, turn off **Pay when ordering** in Store settings → Order settings and take payment at the counter.

## What's inside

| Path | Contents |
|---|---|
| `site/` | Guest and owner screens. A static site with no build step (ES modules); every asset path starts with `/`. Deploy it as is to Weegloo Web Hosting (SPA mode). |
| `weegloo/scripts/` | The six Weegloo Scripts that run on the server: `place-order`, `start-checkout`, `confirm-payment`, `refund-order`, `order-status`, `staff-call` |
| `weegloo/content-types/` | The data model: store settings (`store`), menu section (`section`), menu item (`item`), order (`order`), staff call (`call`), order counter (`counter`) |
| `weegloo/space-role.customer.json` | The role behind the guest screen's token (what it may read and which Scripts it may run) |

The files under `weegloo/` are reference copies of the installed Space's resources. An install from the
marketplace already creates the same resources, so to change one, edit it in your Space in the Weegloo console.

## First: fill in the placeholders

This source holds no values from any particular Space. It has placeholders such as `__SPACE_ID__` instead.

- **`site/js/config.js`** — the easiest way is to take your installed site's own settings file. Open
  `https://<your site address>/js/config.js` in a browser, copy it and overwrite this file. The install already
  rewrote that file with your Space's values.
- **`site/index.html`** — replace `https://YOUR-SUBDOMAIN.weegloo.app` in `og:image` and `twitter:image` with your site address.
- **`weegloo/scripts/*.json`** — only when you create or overwrite a Script from these files, replace the values in the table below.

| Placeholder | `config.js` key | Meaning |
|---|---|---|
| `__SPACE_ID__` | `spaceId` | Space id |
| `__CUSTOMER_TOKEN__` | `customerToken` | Space Access Token for the guest screen (a public value) |
| `__STORE_ID__` | `storeId` | id of the (single) store settings entry |
| `__COUNTER_ID__` | `counterId` | id of the (single) order counter entry |
| `__CT_STORE__` … `__CT_COUNTER__` | `contentTypes.store` … `contentTypes.counter` | ContentType ids |
| `__SCRIPT_PLACE_ORDER__` … `__SCRIPT_REFUND_ORDER__` | `scripts.placeOrder` … `scripts.refundOrder` | Script ids |
| `__GOOGLE_MAPS_EMBED_KEY__` | `mapsEmbedKey` | Key for the map on the store info screen (Google Maps Embed API) |

> You don't set the return addresses after payment (`success_url`, `cancel_url`). `start-checkout` builds them from the address
> of the site the order came from, so your installed address or your own domain is used as is. If your Space has no
> `start-checkout` Script (an older install), `place-order` creates the Stripe session itself, and in installs from before
> October 29, 2026 both addresses there may be fixed to another site. Moving to the current Scripts fixes both
> (see [Updating an older install](#updating-an-older-install)).

## How it works

| Caller | API | Credential |
|---|---|---|
| Guest: reads the store and menu | CDA (published only) | `customerToken` — may only read store, sections and menu, and run the five guest Scripts |
| Guest: order, payment start, payment check, order status, staff call | Script `/execute` | Same token |
| Owner: everything else | CMA (+ the `refund-order` Script) | Weegloo console sign-in popup token; members of this Space only |

- **The server decides the amount.** `place-order` totals the order from the published menu and option prices and stores it on the order (`total`). Amounts sent by the screen are never used.
- **The server decides whether it was paid.** `confirm-payment` asks the provider directly and confirms the order only when payment status, order id and amount all match. Landing on the return address confirms nothing by itself.
- Orders are never published, so they are not visible over CDA. A guest sees status only for the order ids stored on their own device, through `order-status`.

## The current payment flow (Stripe Checkout)

When **Pay when ordering** (`store.prepay`) is on:

1. Ordering from the cart calls `place-order`, which computes the amount, stores the order with `status: pending` and `payment: pending` and returns `{ prepay: true, order: { id, … } }`. Pending orders do not appear on the owner's screens.
2. The screen (`place()` in `site/js/customer/views.js`) then calls `start-checkout` with that order id. It creates a Stripe Checkout session for the amount stored on the order and returns `{ pay: { orderId, url } }`. It does this once per order (it marks the order first, with a `sys.version` lock) and only within 30 minutes of the order.
   The return addresses are built from the request's `Origin` header (the site the order came from). Without that header, or when it is not a site address, the call is refused with `bad-origin` and the order stays `pending`, never shown.
3. The screen remembers the order id on the device (`addPendingPay`) and goes to the Stripe payment page.
4. After payment, Stripe sends the guest to `success_url` (`/paid/{order id}`). That screen (`paidScreen()`) calls `confirm-payment`.
5. `confirm-payment` looks up the Stripe session and, only if `payment_status: paid`, `client_reference_id` (= the order id) and `amount_total` (= the order's `total`) all match, gives the order its number (from `A-001` each day) and sets `status: new`, `payment: paid`. This is when the owner's alert sounds. The order is patched with a `sys.version` lock, so it is never confirmed twice.
6. If the guest cancels, Stripe returns them to `cancel_url` (`/cart?pay=cancel&order=…`) with the cart untouched.
7. When the owner rejects or refunds a paid order, `refund-order` asks Stripe for a refund (an `Idempotency-Key` prevents a double refund) and only after Stripe accepts it marks the order `rejected` (a served order stays `done`) and `payment: refunded`.

With **Pay when ordering** off, `place-order` stores the order as `new` with its number right away (pay at the counter), and the screen skips `start-checkout`. `place-order` never calls the payment provider.

## Switching to another payment provider

To take real card payments, switch payments to the payment provider (PG) your shop has a contract with. You don't edit any
code yourself: you ask an AI agent in plain words. The agent changes the payment part using this repository's code, updates
the server functions (Scripts) in your Space and uploads the site to your web hosting again. The site files installed from
the Marketplace cannot be changed where they are, which is why the agent works from this repository's code.

### What you need

- **A provider contract and keys**: sign up with the provider and get both **test keys** and **live keys** from its admin
  screen. Keys usually come in pairs: one that is safe to show (the client key) and a secret one that must never be shown (the
  secret key).
- **An AI agent**: connect Weegloo to an AI agent such as Claude Code, Codex or Cursor as described in
  [Weegloo docs — Connecting](https://docs.weegloo.com/ai/tools/connect). Sign in with a Weegloo account that is an admin of the
  Space where you installed QR Order.
- **Your site's address**: the address guests reach from the table QR (e.g. `https://myshop.weegloo.app`).

### Steps

1. **Ask first whether it can be done**: providers connect in different ways, so some cannot be used with this app, and some
   need a paid Weegloo plan (see [Weegloo Free plan](#weegloo-free-plan)). Ask first:

   ```text
   Check whether the payments in https://github.com/weegloo-apps/qr-order can be switched to [provider].
   ```

   If the answer is no, ask the provider whether it offers another way to connect.
2. **Ask for the switch**:

   ```text
   Download https://github.com/weegloo-apps/qr-order, switch its payment system to [provider] and deploy it.
   My site's address is [your site address].
   ```

   When it asks which Space to work in, pick the Space where you installed QR Order. When it asks for keys, give it the
   **test keys** first.
3. **Try a test payment**: once it is deployed, scan a table QR with your phone and check the following. Test keys never move
   real money.
   - Paying shows the order complete screen and an order number.
   - The order shows up on the owner screen (`/admin`) and the alert sounds.
   - Cancelling in the payment window brings you back to the cart, and no order shows up on the owner screen.
   - Refunding the order on the owner screen shows it as cancelled in the provider's admin screen too.
   - The amount in the provider's admin screen matches the order amount.

   If anything looks wrong, tell the agent what you saw and it will fix it.
4. **Switch to live keys**: ask "Switch to the live keys and deploy it" and give it the live keys. Then make one small real
   payment and refund it.
5. **Final checks**: ask the agent these two things.
   - "Check that the secret key is not in the site files." Anyone can read the site files, so the secret key belongs only in
     the server functions (Scripts).
   - "Check that the payment amount and whether it was paid are confirmed on the server, directly with the provider." If the
     values the guest screen sends are trusted as they are, the amount can be faked.

### Good to know when switching

- Set the store currency to one your provider accepts.
- Once the site is uploaded again, you can no longer change the site's title, description and share image in the console.
  The agent carries the current values over to the new site (if you gave it your site's address), and for later changes you
  ask the agent too.

### Staying on Stripe

If you have a Stripe account, you can take real payments on it without switching providers. Ask the agent "Switch payments to
real payments on my Stripe account and deploy it" and give it your Stripe secret key. Creating a restricted key (`rk_live_…`)
with fewer permissions in the Stripe dashboard is safer. To have orders confirmed even when a guest closes the page right after
paying, also ask "Receive Stripe's webhook too"; the agent tells you what to do in the Stripe dashboard. Then make a small
payment and refund and run the final checks, as in steps 4 and 5 above.

## Weegloo Free plan

QR Order fits the Weegloo Free plan. Limits there apply to the whole Organization, shared by all its Spaces.

- **Script size**: 30 statements per Script, nested ones included. The Scripts here use place-order 29,
  confirm-payment 29, start-checkout 23, staff-call 21, refund-order 18 and order-status 15. That is why starting
  the payment is a Script of its own. Keep any change you make within 30.
- **Number of Scripts**: 6 of the Organization's 10.
- **Script runs**: 10,000 a month. When they run out, every Script in the Organization is blocked until the next
  month or an upgrade, so guests can no longer order. An order uses one `place-order` run (with Pay when ordering,
  one `start-checkout` and one `confirm-payment` more), a staff call one run, and while a guest keeps the order
  screen visible, one `order-status` run every 20 seconds (for up to 1 hour). A guest who watches for 10 minutes
  uses about 33 runs for one order, which comes to roughly 300 orders a month. Busier stores need a paid plan
  (Basic: 100,000 runs, 50 statements per Script).
- **Content**: orders and staff calls are kept and count toward the Content limit (20,000).

### Updating an older install

If your Space has no `start-checkout` Script, its `place-order` creates the Stripe session itself and is over the
Free plan's 30 statements. To move to the current Scripts:

1. Create a Script from `weegloo/scripts/start-checkout.json` (replace the placeholders as in the table above) and put
   your Stripe secret key in its `STRIPE_SECRET_KEY` secret.
2. Add it to the guest role's Script `Execute` list, as in `weegloo/space-role.customer.json`.
3. Set its id as `scripts.startCheckout` in `site/js/config.js` and deploy the site (below). The screen works with both
   the old and the new `place-order`, so nothing breaks between steps.
4. Overwrite `place-order` and `confirm-payment` with the files in `weegloo/scripts/` (placeholders replaced). The files
   carry the secret empty, so put your Stripe secret key back in `confirm-payment`'s `STRIPE_SECRET_KEY`.

## Deploying

1. Zip the **contents** of `site/` (`index.html` at the top of the ZIP).
2. In the Weegloo console → Web Hosting → your site, update it with the new ZIP. Keep SPA mode on (`index.html` handles addresses such as `/t/3` and `/paid/…`).

> Once you upload a new ZIP to a Web Hosting installed from the marketplace, page metadata (title, description,
> share image) can no longer be edited from the console. From then on, edit the `<head>` of `site/index.html` and redeploy.

## Good to know

- **Time zone**: times are stored in UTC, and the screens show them in the store's time zone. The first time the admin screen opens, it saves that device's time zone (`store.timeZone`, e.g. `Asia/Seoul`) and its current UTC offset in minutes (`store.utcOffsetMin`). The zone stays put after that; the offset is refreshed whenever the admin screen opens after a daylight saving change. Scripts cannot convert time zones, so `place-order` and `confirm-payment` use `utcOffsetMin` for opening hours, last order and the day an order is counted in (`businessDay`, order numbers from `A-001`). Until a store has the value, they use Korea time (`32400000`, 9 hours). If you installed before October 29, 2026, your Space has neither the two store fields nor this logic and stays on Korea time: add the fields from `weegloo/content-types/store.json` and replace the `32400000` in the two Scripts as in `weegloo/scripts/`.
- **Default locale**: the Scripts read and write language-neutral values under `en-US` and assume it is the Space's default locale.
- **Screen text (10 languages)**: English, Korean, Japanese, Simplified Chinese, German, French, Spanish, Portuguese, Hindi and Indonesian. The English source is the `EN` dictionary in `site/js/i18n.js`; the other nine are in `site/i18n/<language>.js` (`ko`, `ja`, `zh`, `de`, `fr`, `es`, `pt`, `hi`, `id`) and load only when that language is in use. A missing key or value shows the English text.
  - The language list follows the Space's Locales, and a Locale picks its dictionary by its language part (`ja-JP` → `ja`, `pt-BR` → `pt`). A language without a dictionary (such as `nl`) and Traditional Chinese (`zh-TW`, `zh-HK`, `zh-MO`, `zh-Hant…`) get English screen text, while the content shows in that language. To offer another language, add a Locale to the Space.
  - Number, date and currency formats (`Intl`), the Stripe checkout language and the map language follow the screen-text language; a language without a dictionary uses `en-US` formats. Stripe has no Hindi, so it picks from the browser (`auto`). Japanese and Chinese screens use system fonts, so their characters are not drawn in the Korean font (Noto Sans KR).
  - The admin screens follow the same language choice (separate from the input-language tabs). The menu editor's option presets (temperature, size, extras) are named in all ten languages in `site/js/admin/menu.js`.
  - Templates: `{name}` is a value, `{n#singular/plural}` takes the first form when n is 1, and `{name~을/를}` is a Korean-only particle. To add a language, copy `site/i18n/ko.js` and translate the values only (keep the keys and the `{…}` names), then add the language code to `PRESETS` in `site/js/i18n.js` and to the preset names in `site/js/admin/menu.js`.
  - The eight languages other than English and Korean are machine translations; have a native speaker review them before a real store uses them. "Powered by Weegloo" is not translated.
- **Usage**: while a guest is watching an order, the guest screen calls `order-status` every 20 seconds (for up to 1 hour), which counts toward Weegloo Script runs (see [Weegloo Free plan](#weegloo-free-plan)).
