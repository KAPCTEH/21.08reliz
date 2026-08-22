'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { downloadVerifiedPayload, verifyPayloadFile } = require('../source/application/update/downloader.cjs');

let checks = 0;
function checked(action) { action(); checks += 1; }
async function expectCode(code, action) {
  await assert.rejects(action, error => error?.code === code, `Expected ${code}`);
  checks += 1;
}
function fakeTransport(responses, observedRanges = []) {
  let index = 0;
  return (_url, requestOptions, callback) => {
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.destroy = error => request.emit('error', error);
    request.end = () => {
      const spec = responses[index++];
      observedRanges.push(requestOptions.headers.Range || null);
      queueMicrotask(() => {
        if (spec.error) return request.emit('error', spec.error);
        const response = new PassThrough();
        response.statusCode = spec.status;
        response.headers = spec.headers || {};
        callback(response);
        response.end(spec.body);
      });
    };
    return request;
  };
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-downloader-'));
  try {
    const body = Buffer.from('hello world');
    const sha256 = crypto.createHash('sha256').update(body).digest('hex');
    const destination = path.join(directory, 'JustFun-7.9.0-win-x64.zip');
    const ranges = [];
    const result = await downloadVerifiedPayload({
      url: 'https://downloads.justfun.invalid/JustFun-7.9.0-win-x64.zip',
      allowedHosts: ['downloads.justfun.invalid'],
      destination,
      expectedBytes: body.length,
      expectedSha256: sha256,
      maxAttempts: 2,
      baseRetryDelayMs: 0,
      requestImpl: fakeTransport([
        { status: 200, headers: { 'content-length': '5' }, body: body.subarray(0, 5) },
        { status: 206, headers: { 'content-length': '6', 'content-range': 'bytes 5-10/11' }, body: body.subarray(5) },
      ], ranges),
    });
    checked(() => assert.equal(result.attempts, 2));
    checked(() => assert.deepEqual(ranges, [null, 'bytes=5-']));
    checked(() => assert.deepEqual(fs.readFileSync(destination), body));
    checked(() => assert.equal(fs.existsSync(`${destination}.part`), false));
    assert.equal(await verifyPayloadFile(destination, body.length, sha256), true);
    checks += 1;

    const reused = await downloadVerifiedPayload({
      url: 'https://downloads.justfun.invalid/JustFun-7.9.0-win-x64.zip',
      allowedHosts: ['downloads.justfun.invalid'], destination,
      expectedBytes: body.length, expectedSha256: sha256,
      requestImpl: () => { throw new Error('network must not be used'); },
    });
    checked(() => assert.equal(reused.reused, true));

    const resumedDestination = path.join(directory, 'complete-part.zip');
    fs.writeFileSync(`${resumedDestination}.part`, body);
    const resumed = await downloadVerifiedPayload({
      url: 'https://downloads.justfun.invalid/complete-part.zip', allowedHosts: ['downloads.justfun.invalid'], destination: resumedDestination,
      expectedBytes: body.length, expectedSha256: sha256,
      requestImpl: () => { throw new Error('network must not be used for a complete verified partial file'); },
    });
    checked(() => assert.equal(resumed.reused, true));
    checked(() => assert.equal(fs.existsSync(resumedDestination), true));

    await expectCode('UPDATE_URL_INVALID', () => downloadVerifiedPayload({ url: 'http://downloads.justfun.invalid/file.zip', allowedHosts: ['downloads.justfun.invalid'], destination: path.join(directory, 'http.zip'), expectedBytes: 1, expectedSha256: 'a'.repeat(64) }));
    await expectCode('UPDATE_URL_INVALID', () => downloadVerifiedPayload({ url: 'https://downloads.justfun.invalid:444/file.zip', allowedHosts: ['downloads.justfun.invalid'], destination: path.join(directory, 'port.zip'), expectedBytes: 1, expectedSha256: 'a'.repeat(64) }));
    await expectCode('UPDATE_URL_HOST', () => downloadVerifiedPayload({ url: 'https://attacker.invalid/file.zip', allowedHosts: ['downloads.justfun.invalid'], destination: path.join(directory, 'host.zip'), expectedBytes: 1, expectedSha256: 'a'.repeat(64) }));

    const corrupt = path.join(directory, 'corrupt.zip');
    await expectCode('UPDATE_DOWNLOAD_HASH', () => downloadVerifiedPayload({
      url: 'https://downloads.justfun.invalid/corrupt.zip', allowedHosts: ['downloads.justfun.invalid'], destination: corrupt,
      expectedBytes: body.length, expectedSha256: 'f'.repeat(64), maxAttempts: 1,
      requestImpl: fakeTransport([{ status: 200, headers: { 'content-length': String(body.length) }, body }]),
    }));
    checked(() => assert.equal(fs.existsSync(`${corrupt}.part`), false));

    const oversized = path.join(directory, 'oversized.zip');
    await expectCode('UPDATE_DOWNLOAD_SIZE', () => downloadVerifiedPayload({
      url: 'https://downloads.justfun.invalid/oversized.zip', allowedHosts: ['downloads.justfun.invalid'], destination: oversized,
      expectedBytes: 5, expectedSha256: 'f'.repeat(64), maxAttempts: 1,
      requestImpl: fakeTransport([{ status: 200, headers: { 'content-length': '11' }, body }]),
    }));
    checked(() => assert.equal(fs.existsSync(`${oversized}.part`), false));

    process.stdout.write(`${JSON.stringify({ ok: true, checks })}\n`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
