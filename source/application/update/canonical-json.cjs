'use strict';

function assertUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) throw new TypeError('Canonical JSON rejects an unpaired high surrogate.');
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      throw new TypeError('Canonical JSON rejects an unpaired low surrogate.');
    }
  }
}

function canonicalize(value, stack = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    assertUnicode(value);
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers.');
    if (Object.is(value, -0)) return '0';
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new TypeError(`Canonical JSON rejects ${typeof value}.`);
  if (stack.has(value)) throw new TypeError('Canonical JSON rejects cyclic values.');
  stack.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map(item => canonicalize(item, stack)).join(',')}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Canonical JSON accepts plain objects only.');
    const entries = [];
    for (const key of Object.keys(value).sort()) {
      assertUnicode(key);
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
        throw new TypeError(`Canonical JSON rejects unsupported value at ${key}.`);
      }
      entries.push(`${JSON.stringify(key)}:${canonicalize(item, stack)}`);
    }
    return `{${entries.join(',')}}`;
  } finally {
    stack.delete(value);
  }
}

function canonicalBytes(value) {
  return Buffer.from(canonicalize(value), 'utf8');
}

module.exports = { canonicalize, canonicalBytes };
