const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const cards = [
  ...Array.from({ length: 11 }, (_, index) => `<article class="route-card" data-route-stage="active" id="active-${index}"><button class="route-head"></button></article>`),
  ...Array.from({ length: 3 }, (_, index) => `<article class="route-card" data-route-stage="draft" id="draft-${index}"><button class="route-head"></button></article>`)
].join('');
const dom = new JSDOM(`<main id="tripsView"><section id="tripsArea">${cards}</section></main>`, { runScripts: 'dangerously' });
const { window } = dom;
let selectedStage = 'active';
window.routeStageMatchesV560 = stage => stage === selectedStage;
window.cleanupRouteUiV591 = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
window.requestAnimationFrame = callback => callback();

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'application', 'web', 'assets', 'js', '94-route-workspace-final.js'), 'utf8');
window.eval(source);
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true }));

setTimeout(() => {
  const hidden = id => window.document.getElementById(id).hidden;
  assert.equal(hidden('active-0'), false);
  assert.equal(hidden('active-9'), false);
  assert.equal(hidden('active-10'), true, 'the eleventh filtered route belongs on page two');
  assert.equal(hidden('draft-0'), true, 'pagination must not reveal a route excluded by the stage filter');
  assert.match(window.document.getElementById('routePaginationV593').textContent, /из 11 рейсов/);

  window.setRoutePageV593(2);
  assert.equal(hidden('active-0'), true);
  assert.equal(hidden('active-10'), false);

  selectedStage = 'draft';
  window.document.dispatchEvent(new window.Event('jf:route-stage-filter-changed'));
  assert.equal(hidden('active-10'), true);
  assert.equal(hidden('draft-0'), false, 'changing the stage filter must reset pagination to page one');
  assert.match(window.document.getElementById('routePaginationV593').textContent, /из 3 рейсов/);
  console.log('Route stage pagination unit test: PASS');
  window.close();
}, 10);
