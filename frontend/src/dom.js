// dom.js — tiny helpers for building DOM without a framework.
// Used by every file in src/views/.

/** h('div', {class: 'x', onClick: fn}, 'text', childElement) -> HTMLElement */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Remove all children of an element and return it. */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}
