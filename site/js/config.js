// Public, browser-safe settings. Everything here ships to every visitor.
// customerToken: SpaceAccessToken whose role may only read the published store/menu and execute the
// customer Scripts (place-order, confirm-payment, order-status, staff-call). It cannot read or write
// orders directly, and cannot run refund-order (admins only).
export const CONFIG = {
  spaceId: '__SPACE_ID__',
  cma: 'https://cma.weegloo.com',
  cda: 'https://cda.weegloo.com',
  upload: 'https://upload.weegloo.com',
  script: 'https://script.weegloo.com',
  console: 'https://console.weegloo.com',
  customerToken: '__CUSTOMER_TOKEN__',
  storeId: '__STORE_ID__',
  counterId: '__COUNTER_ID__',
  contentTypes: {
    store: '__CT_STORE__',
    section: '__CT_SECTION__',
    item: '__CT_ITEM__',
    order: '__CT_ORDER__',
    call: '__CT_CALL__',
    counter: '__CT_COUNTER__',
  },
  scripts: {
    placeOrder: '__SCRIPT_PLACE_ORDER__',
    orderStatus: '__SCRIPT_ORDER_STATUS__',
    staffCall: '__SCRIPT_STAFF_CALL__',
    confirmPayment: '__SCRIPT_CONFIRM_PAYMENT__',
    refundOrder: '__SCRIPT_REFUND_ORDER__',
  },
  // Google Maps Embed API key (public by design: it travels inside the iframe src).
  mapsEmbedKey: '__GOOGLE_MAPS_EMBED_KEY__',
};

// Stored values are codes; their labels live in the i18n dictionaries.
export const BRAND_COLORS = [
  ['#C2410C', 'orange'],
  ['#1D4ED8', 'blue'],
  ['#15803D', 'green'],
  ['#111111', 'black'],
];

export const PAYMENT_METHODS = ['card', 'cash', 'easy', 'transfer'];

// Card payments run on Stripe's public sample keys (test mode): nothing is charged and only Stripe's
// test cards work, so the checkout shows this number. Remove it when live Stripe keys go in.
export const TEST_CARD = '4242 4242 4242 4242';
export const CALL_REASONS = ['water', 'napkin', 'cutlery', 'other'];
export const BADGES = ['popular', 'new'];
