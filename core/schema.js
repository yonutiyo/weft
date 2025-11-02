// core/schema.mjs
// v2c schema normalization + validation (append-only friendly)

function isObject(x){ return x && typeof x === "object" && !Array.isArray(x); }

export function normalizeV2c(packLike) {
  if (!packLike || typeof packLike !== "object") throw new Error("normalizeV2c: input must be an object");
  const fmt = "fmt" in packLike ? packLike.fmt : "v2c";
  if (fmt !== "v2c") throw new Error(`normalizeV2c: expected fmt "v2c", got ${fmt}`);

  const ids  = Array.isArray(packLike.ids)  ? packLike.ids.slice()  : [];
  const html = Array.isArray(packLike.html) ? packLike.html.slice() : [];
  const idx  = Array.isArray(packLike.idx)  ? packLike.idx.map(a => Array.isArray(a) ? a.slice() : []) : [];
  const n = Math.min(ids.length, html.length, idx.length);

  let tags = Array.isArray(packLike.tags) ? packLike.tags.map(a => Array.isArray(a) ? a.slice() : []) : null;
  if (!tags || tags.length !== n) tags = Array.from({length:n}, () => []);

  const meta = isObject(packLike.meta) ? { ...packLike.meta } : {};
  const version = Number.isInteger(packLike.version) ? packLike.version : 1;

  const start = typeof packLike.start === "string" && packLike.start ? packLike.start : (ids[0] || "start");

  return { fmt:"v2c", version, start, ids:ids.slice(0,n), html:html.slice(0,n), idx:idx.slice(0,n), tags, meta };
}

function validateIds(ids) {
  const seen = new Set();
  for (let i=0;i<ids.length;i++){
    const id = ids[i];
    if (typeof id !== "string" || id.length === 0) return `ids[${i}] must be a non-empty string`;
    if (seen.has(id)) return `duplicate id "${id}"`;
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return `id "${id}" contains unsupported characters`;
    seen.add(id);
  }
  return null;
}
function validateIdx(idx, len) {
  for (let i=0;i<idx.length;i++){
    const arr = idx[i];
    if (!Array.isArray(arr)) return `idx[${i}] must be an array`;
    for (let j=0;j<arr.length;j++){
      const k = arr[j];
      if (!Number.isInteger(k) || k < 0 || k >= len) return `idx[${i}][${j}] out of range`;
    }
    const set = new Set(arr);
    if (set.size !== arr.length) return `idx[${i}] contains duplicates`;
  }
  return null;
}
function validateTags(tags) {
  for (let i=0;i<tags.length;i++){
    const arr = tags[i];
    if (!Array.isArray(arr)) return `tags[${i}] must be an array`;
    for (const t of arr) {
      if (typeof t !== "string") return `tags[${i}] contains non-string`;
      if (t !== t.trim()) return `tags[${i}] tag "${t}" has leading/trailing space`;
    }
  }
  return null;
}

export function validateV2c(pack) {
  if (!pack || pack.fmt !== "v2c") return { ok:false, error:`fmt must be "v2c"` };
  const { ids, html, idx, tags } = pack;
  if (!Array.isArray(ids) || !Array.isArray(html) || !Array.isArray(idx) || !Array.isArray(tags)) {
    return { ok:false, error:"ids/html/idx/tags must be arrays" };
  }
  if (!(ids.length === html.length && html.length === idx.length && idx.length === tags.length)) {
    return { ok:false, error:"ids/html/idx/tags lengths must match" };
  }
  const e1 = validateIds(ids); if (e1) return { ok:false, error:e1 };
  const e2 = validateIdx(idx, ids.length); if (e2) return { ok:false, error:e2 };
  const e3 = validateTags(tags); if (e3) return { ok:false, error:e3 };
  if (typeof pack.start !== "string" || !pack.start) return { ok:false, error:"start must be a non-empty string" };
  if (!ids.includes(pack.start)) return { ok:false, error:`start id "${pack.start}" not present in ids` };
  return { ok:true };
}