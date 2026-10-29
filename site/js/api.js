import { CONFIG } from '/js/config.js';
import { defaultLocale, isBucket, pick } from '/js/i18n.js';
import { sleep } from '/js/util.js';

const S = CONFIG.spaceId;

export class ApiError extends Error {
  constructor(message, status, code, data) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

// Weegloo answers with its vendor JSON type, so no Accept header is sent.
export async function request(url, { method = 'GET', token, body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (token) init.headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(data?.reason || data?.message || `Request failed (${res.status})`, res.status, data?.sys?.code, data);
  return data;
}

// Management (CMA) and delivery with locale=* return per-locale buckets; a value is picked for the
// chosen locale through its fallback chain, then the Space default. A flat value is returned as is.
export function val(fields, key, locale) {
  const v = fields?.[key];
  return isBucket(v) ? pick(v, locale) : v;
}

export function plain(item, locale) {
  const o = { id: item.sys.id, createdAt: item.sys.createdAt };
  for (const k of Object.keys(item.fields || {})) o[k] = val(item.fields, k, locale);
  return o;
}

// A field value written per locale ({ 'en-US': …, 'ko-KR': … }). Anything else is written to the
// Space default locale, which is where non-localized fields live.
export class Localized {
  constructor(map) { this.map = map || {}; }
  bucket() {
    const b = {};
    for (const [k, v] of Object.entries(this.map)) {
      const x = typeof v === 'string' ? v.trim() : v;
      if (x !== undefined && x !== null && x !== '') b[k] = x;
    }
    return Object.keys(b).length ? b : null;
  }
}
export const localized = (map) => new Localized(map);
function bucketOf(v) {
  if (v instanceof Localized) return v.bucket();
  return v === undefined || v === null || v === '' ? null : { [defaultLocale()]: v };
}

const nextPath = (d) => (d?.links?.next ? d.links.next.replace(/^\/v1/, '') : null);

// ---------- Customer: published store + menu (CDA, read through the customer token) ----------
// locale=* returns every locale's value, so switching language needs no new request.
async function cdaAll(ctId, select) {
  const out = [];
  let path = `/spaces/${S}/content-types/${ctId}/contents?limit=100&locale=*&select=${select}`;
  for (let guard = 0; path && guard < 10; guard++) {
    const d = await request(`${CONFIG.cda}/v1${path}`, { token: CONFIG.customerToken });
    out.push(...(d.items || []));
    path = nextPath(d);
  }
  return out;
}

// Raw resources (fields as locale buckets); callers pick the locale with val()/plain().
export function fetchPublicStore() {
  return request(`${CONFIG.cda}/v1/spaces/${S}/content-types/${CONFIG.contentTypes.store}/contents/${CONFIG.storeId}?locale=*`, { token: CONFIG.customerToken });
}

export async function fetchPublicMenu() {
  const CT = CONFIG.contentTypes;
  const [sections, items] = await Promise.all([
    cdaAll(CT.section, 'sys.id,sys.createdAt,fields.name,fields.sortOrder'),
    cdaAll(CT.item, 'sys.id,sys.createdAt,fields.name,fields.description,fields.detail,fields.price,fields.section,fields.badge,fields.soldOut,fields.sortOrder,fields.optionGroups,fields.image'),
  ]);
  // A Refer → Media holds only an id: resolve every menu photo with one list read by sys.id[in].
  let medias = [];
  try {
    medias = await mediaByIds(imageIds(items), (path) => request(`${CONFIG.cda}/v1${path}&locale=*`, { token: CONFIG.customerToken }));
  } catch (e) {
    console.error(`[menu] Could not load menu photos: ${e.message}`);
  }
  return { sections, items, medias };
}

// ---------- Media (menu photos) ----------
export const imageIds = (items) => [...new Set(items.map((x) => val(x.fields, 'image')?.sys?.id).filter(Boolean))];

async function mediaByIds(ids, get) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const d = await get(`/spaces/${S}/medias?sys.id[in]=${ids.slice(i, i + 50).join(',')}&select=sys.id,fields.file&limit=100`);
    out.push(...(d.items || []));
  }
  return out;
}

// The file URL of a Media (per-locale bucket or flat), optionally resized with a /styleN preset
// (style3 = 128px … style9 = 960px, longest side, WebP).
export function mediaUrl(media, style) {
  const file = val(media?.fields, 'file');
  let url = file?.url;
  if (!url) return null;
  if (url.startsWith('//')) url = `https:${url}`;
  return style ? `${url}/${style}` : url;
}

// ---------- Scripts (server-side order logic) ----------
export async function runScript(id, payload, token = CONFIG.customerToken) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${CONFIG.script}/v1/spaces/${S}/scripts/${id}/execute`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    const status = data?.statusCode ?? res.status;
    if (res.ok && status < 400 && data && 'return' in data) return data.return;
    const code = data?.error?.error || data?.sys?.code || null;
    // The order counter is version-locked; a concurrent order answers "busy" and is simply retried.
    if (code === 'busy' && attempt < 3) { await sleep(250 * (attempt + 1) + Math.random() * 250); continue; }
    throw new ApiError(data?.reason || code || `Request failed (${status})`, status, code, data?.error || data);
  }
}

// ---------- Admin (Weegloo User session → CMA) ----------
const TOKEN_KEY = 'access_token';
export const adminAuth = {
  get() {
    try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  // keep = "keep me signed in": survive closing the tab. Otherwise the token lives only in this tab.
  set(token, keep) {
    try {
      (keep ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
      (keep ? sessionStorage : localStorage).removeItem(TOKEN_KEY);
    } catch { /* storage unavailable */ }
  },
  clear() {
    try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
  },
};

function cma(path, opts = {}) {
  return request(`${CONFIG.cma}/v1${path}`, { ...opts, token: adminAuth.get() }).catch((e) => {
    if (e.status === 401) adminAuth.clear();
    throw e;
  });
}

const contentPath = (ctId, id) => `/spaces/${S}/content-types/${ctId}/contents${id ? `/${id}` : ''}`;
const mediaPath = (id) => `/spaces/${S}/medias${id ? `/${id}` : ''}`;

export const admin = {
  me: () => cma('/me'),
  async isMember() {
    let path = '/me/space-memberships?limit=100';
    for (let guard = 0; path && guard < 20; guard++) {
      const d = await cma(path);
      // The Space ref lives under sys, not on the item root.
      if ((d.items || []).some((m) => m?.sys?.space?.sys?.id === S)) return true;
      path = nextPath(d);
    }
    return false;
  },
  // Every page of a list. `query` holds extra filters (sys.* axes only — they are indexed).
  async list(ctId, { select, query = '', order = 'sys.createdAt,sys.id', maxPages = 60 } = {}) {
    const out = [];
    let path = `${contentPath(ctId)}?limit=100&order=${order}${select ? `&select=${select}` : ''}${query ? `&${query}` : ''}`;
    for (let guard = 0; path && guard < maxPages; guard++) {
      const d = await cma(path);
      out.push(...(d.items || []));
      path = nextPath(d);
    }
    return out;
  },
  get: (ctId, id) => cma(contentPath(ctId, id)),
  create(ctId, values) {
    const fields = {};
    for (const [k, v] of Object.entries(values)) {
      const b = bucketOf(v);
      if (b) fields[k] = b;
    }
    return cma(contentPath(ctId), { method: 'POST', body: { fields } });
  },
  // values: { field: newValue | localized(map) | null }. null / '' / an all-empty map removes the value.
  patch(ctId, item, values) {
    const ops = [];
    for (const [k, v] of Object.entries(values)) {
      const b = bucketOf(v);
      if (!b) {
        if (item.fields?.[k] !== undefined) ops.push({ op: 'remove', path: `/fields/${k}` });
      } else ops.push({ op: 'add', path: `/fields/${k}`, value: b });
    }
    if (!ops.length) return Promise.resolve(item);
    return cma(contentPath(ctId, item.sys.id), {
      method: 'PATCH',
      body: ops,
      headers: { 'Content-Type': 'application/json-patch+json', 'X-Weegloo-Version': String(item.sys.version) },
    });
  },
  publish(item) {
    return cma(`/spaces/${S}/contents/${item.sys.id}/publish`, { method: 'PUT', headers: { 'X-Weegloo-Version': String(item.sys.version) } });
  },
  unpublish(item) {
    return cma(`/spaces/${S}/contents/${item.sys.id}/publish`, { method: 'DELETE', headers: { 'X-Weegloo-Version': String(item.sys.version) } });
  },
  async remove(ctId, item) {
    let cur = item;
    if (cur.sys.status === 'Published' || cur.sys.status === 'Changed') cur = await this.unpublish(cur);
    await cma(contentPath(ctId, cur.sys.id), { method: 'DELETE' });
  },
  // Write a change and make it visible to customers right away.
  async patchPublish(ctId, item, values) {
    const p = await this.patch(ctId, item, values);
    return this.publish(p);
  },
  async createPublish(ctId, values) {
    return this.publish(await this.create(ctId, values));
  },

  // ---- Menu photos: Upload API → CMA Media (auto-published once processed) ----
  async uploadFile(file) {
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(`${CONFIG.upload}/v1/spaces/${S}/uploads/multipart`, { method: 'POST', headers: { Authorization: `Bearer ${adminAuth.get()}` }, body });
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      if (res.status === 401) adminAuth.clear();
      throw new ApiError(data?.reason || data?.message || `Upload failed (${res.status})`, res.status, data?.sys?.code, data);
    }
    return data;
  },
  createMedia({ upload, fileName, contentType, title }) {
    const d = defaultLocale();
    return cma(mediaPath(), {
      method: 'POST',
      body: { fields: { title: { [d]: title || fileName }, file: { [d]: { fileName, contentType, upload: { sys: { id: upload.sys.id, type: 'Refer', targetType: 'Upload' } } } } } },
    });
  },
  getMedia: (id) => cma(mediaPath(id)),
  mediaList: (ids) => mediaByIds(ids, (path) => cma(path)),
  // Media deletes only from Draft: unpublish first.
  async removeMedia(media) {
    let cur = media;
    if (cur.sys.status === 'Published' || cur.sys.status === 'Changed') {
      cur = await cma(`${mediaPath(cur.sys.id)}/publish`, { method: 'DELETE', headers: { 'X-Weegloo-Version': String(cur.sys.version) } });
    }
    await cma(mediaPath(cur.sys.id), { method: 'DELETE' });
  },
};
