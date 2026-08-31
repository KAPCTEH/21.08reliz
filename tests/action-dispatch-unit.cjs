'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const {JSDOM} = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'application', 'web', 'assets', 'js', '01-action-dispatch-v783.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'source', 'application', 'web', 'index.html'), 'utf8');
const desktop = fs.readFileSync(path.join(__dirname, '..', 'source', 'application', 'web', 'assets', 'js', '110-desktop-platform-v750.js'), 'utf8');
assert(index.includes('id="jfRunDataDiagnostics"'));
assert(desktop.includes("diagnosticButton.onclick=()=>{const fixes=runDataDiagnostics(true)"));
assert(desktop.includes("audit('manual_data_diagnostics_completed',{fixes:Number(fixes)||0})"));
assert(desktop.includes("catch(error){clearTelegramProgress();integrationBadge('jfTelegramBadge','Ошибка','error')"));
const dom = new JSDOM('<!doctype html><button id="action" data-jf-onclick="showView(\'orders\')"></button><input id="flag" type="checkbox" data-jf-onchange="syncFlag(this.checked)"><input id="date" value="2026-08-09"><button id="clear" data-jf-onclick="document.getElementById(\'date\').value=\'\';renderOrders()"></button><button id="route" data-jf-onclick="event.stopPropagation();startRoutePicking(\'route-1\')"></button><button id="blocked" data-jf-onclick="alert(\'unsafe\')"></button><button id="async-failure" data-jf-onclick="startAsyncFailure()"></button>', {
  runScripts: 'dangerously',
  url: 'https://justfun.invalid/',
});
const {window} = dom;
const calls = [];
window.console.error = () => {};
window.showView = function(value){calls.push(['showView', value, this.id])};
window.syncFlag = value => calls.push(['syncFlag', value]);
window.renderOrders = () => calls.push(['renderOrders']);
window.startRoutePicking = value => calls.push(['startRoutePicking', value]);
window.startAsyncFailure = () => Promise.reject(new Error('async failure'));
let blockedErrors = 0;
window.addEventListener('justfun:action-error', () => {blockedErrors += 1});
window.eval(source);

(async()=>{
  window.document.getElementById('action').click();
  const flag = window.document.getElementById('flag');
  flag.checked = true;
  flag.dispatchEvent(new window.Event('change', {bubbles:true}));
  window.document.getElementById('clear').click();
  window.document.getElementById('route').click();
  window.document.getElementById('blocked').click();
  window.document.getElementById('async-failure').click();
  await new Promise(resolve=>window.setTimeout(resolve,0));

  assert.deepEqual(calls, [
    ['showView', 'orders', 'action'],
    ['syncFlag', true],
    ['renderOrders'],
    ['startRoutePicking', 'route-1'],
  ]);
  assert.equal(window.document.getElementById('date').value, '');
  assert.equal(blockedErrors, 2);
  assert.equal(typeof window.JustFunActionBridge.execute, 'function');
  process.stdout.write(`${JSON.stringify({ok:true, checks:8})}\n`);
})().catch(error=>{console.error(error);process.exitCode=1});
