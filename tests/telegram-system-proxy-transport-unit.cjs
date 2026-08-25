'use strict';

const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const path = require('node:path');

const provisioner = require(path.resolve(__dirname, '../source/application/integrations/telegram-cloudflare-native/provisioner.cjs'));

async function main() {
  let captured = null;
  const electronNet = {
    request(options) {
      const request = new EventEmitter();
      const headers = {};
      let body = Buffer.alloc(0);
      request.setHeader = (name, value) => { headers[String(name).toLowerCase()] = String(value); };
      request.write = value => { body = Buffer.concat([body, Buffer.from(value)]); };
      request.abort = () => {};
      request.end = () => queueMicrotask(() => {
        captured = {options, headers, body};
        const response = new EventEmitter();
        response.statusCode = 200;
        response.headers = {'content-type': 'application/json'};
        request.emit('response', response);
        response.emit('data', Buffer.from('{"ok":true}', 'utf8'));
        response.emit('end');
      });
      return request;
    }
  };
  const requestBuffer = provisioner.createRequestBuffer(electronNet);
  const response = await requestBuffer({
    hostname: 'api.telegram.org',
    method: 'POST',
    requestPath: '/bot000000:test/getMe',
    headers: {'Content-Type': 'application/json'},
    body: Buffer.from('{}'),
    timeoutMs: 1000,
    maxBytes: 1024,
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.toString('utf8'), '{"ok":true}');
  assert.equal(captured.options.url, 'https://api.telegram.org/bot000000:test/getMe');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.headers['content-type'], 'application/json');
  assert.equal(captured.headers['content-length'], undefined, 'Electron net must calculate Content-Length after proxy negotiation');
  assert.equal(captured.body.toString('utf8'), '{}');
  console.log(JSON.stringify({ok:true,electronSystemProxyTransport:true,boundedResponse:true}));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
