'use strict';

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseSemver(input) {
  const value = String(input || '');
  const match = SEMVER_PATTERN.exec(value);
  if (!match) throw Object.assign(new Error(`Invalid SemVer: ${value}`), { code: 'UPDATE_VERSION_INVALID' });
  const numericIdentifiers = [match[1], match[2], match[3], ...(match[4] ? match[4].split('.').filter(item => /^\d+$/.test(item)) : [])];
  if (numericIdentifiers.some(item => !Number.isSafeInteger(Number(item)))) {
    throw Object.assign(new Error(`SemVer numeric identifier is too large: ${value}`), { code: 'UPDATE_VERSION_INVALID' });
  }
  return {
    raw: value,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.').map(item => /^\d+$/.test(item) ? Number(item) : item) : [],
    build: match[5] || '',
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (index >= left.length) return -1;
    if (index >= right.length) return 1;
    const a = left[index], b = right[index];
    if (a === b) continue;
    const aNumber = typeof a === 'number', bNumber = typeof b === 'number';
    if (aNumber && bNumber) return a < b ? -1 : 1;
    if (aNumber !== bNumber) return aNumber ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function compareSemver(leftInput, rightInput) {
  const left = parseSemver(leftInput), right = parseSemver(rightInput);
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

module.exports = { SEMVER_PATTERN, parseSemver, compareSemver };
