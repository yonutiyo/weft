// engine/sanitize.js
// Minimal, efficient allowlist sanitizer for passage HTML.

const ALLOWED_TAGS = new Set([
  'a','p','div','span','em','strong','b','i','u','s','small','mark',
  'ul','ol','li','hr','br','blockquote','pre','code',
  'h1','h2','h3','h4','h5','h6','section','article','nav',
  'img','figure','figcaption'
]);

const URL_ATTRS = new Set(['href','src']);
const KEEP_ATTRS = new Set(['id','class','title','alt','role','tabindex']);

function isAllowedTag(tag) { return ALLOWED_TAGS.has(tag); }
function isDataAttr(name) { return name.startsWith('data-') || name.startsWith('aria-'); }

function isSafeUrl(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim().toLowerCase();
  if (v.startsWith('javascript:')) return false;
  if (v.startsWith('data:')) return false;
  return true; // allow http(s)/mailto/relative/hash
}

/**
 * Sanitize HTML into a safe string
 * @param {string} html
 * @returns {string}
 */
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
  const toRemove = [];
  const onAttrs = [];

  for (let node = walker.currentNode; node; node = walker.nextNode()) {
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    if (!isAllowedTag(tag)) { toRemove.push(node); continue; }
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name; const lname = name.toLowerCase(); const value = attr.value;
      if (lname.startsWith('on')) { onAttrs.push({ node, name }); continue; }
      if (URL_ATTRS.has(lname)) {
        if (!isSafeUrl(value)) { node.removeAttribute(name); continue; }
        if (lname === 'href' && node.getAttribute('target') === '_blank') {
          if (!node.hasAttribute('rel')) node.setAttribute('rel','noopener noreferrer');
        }
        continue;
      }
      if (KEEP_ATTRS.has(lname) || isDataAttr(lname)) continue;
      node.removeAttribute(name);
    }
  }

  for (const n of toRemove) n.remove();
  for (const {node,name} of onAttrs) node.removeAttribute(name);

  return tpl.innerHTML;
}
