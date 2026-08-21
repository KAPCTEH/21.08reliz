'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.resolve(__dirname, '../source/application/web/assets/js/00-app-bundle-v595.js'), 'utf8');
const html = fs.readFileSync(path.resolve(__dirname, '../source/application/web/index.html'), 'utf8');

assert.match(app, /function resizeObserverNoise/);
assert.match(app, /e\.preventDefault\?\.\(\)/);
assert.match(app, /Результат операции не подтверждён/);
assert.match(app, /Код события:/);
assert.doesNotMatch(app, /Ошибка интерфейса устранена/);
assert.doesNotMatch(app, /Система сохранила данные и продолжила работу/);
const healthBlock = html.match(/<div class="app-health" id="appHealth">[\s\S]*?<\/div><\/div><\/div>/)?.[0] || '';
assert.ok(healthBlock);
assert.doesNotMatch(healthBlock, /resetAllFilters/);

console.log(JSON.stringify({
  ok: true,
  resizeObserverNoiseHidden: true,
  noFalseRecoveryClaim: true,
  incidentIdShown: true,
  irrelevantFilterResetRemoved: true
}));
