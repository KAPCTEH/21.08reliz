'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { updateError } = require('./catalog.cjs');

function allowedHttpsUrl(input, allowedHosts) {
  let url;
  try { url = new URL(String(input || '')); }
  catch { throw updateError('UPDATE_URL_INVALID', 'Payload URL is invalid.'); }
  const hosts = new Set((allowedHosts || []).map(host => String(host).toLowerCase()));
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw updateError('UPDATE_URL_INVALID', 'Payload URL must be credential-free HTTPS on the standard port without a fragment.');
  if (!hosts.has(url.hostname.toLowerCase())) throw updateError('UPDATE_URL_HOST', 'Payload URL host is not allowed.');
  return url;
}

function validateDestination(destination) {
  const target = path.resolve(String(destination || ''));
  const name = path.basename(target);
  if (!/^[^/\\]+\.zip$/i.test(name) || target !== path.join(path.dirname(target), name)) throw updateError('UPDATE_DOWNLOAD_PATH', 'Payload destination is invalid.');
  return target;
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function verifyPayloadFile(file, expectedBytes, expectedSha256) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size !== expectedBytes) return false;
  return (await sha256File(file)) === expectedSha256;
}

function wait(delayMs) {
  return delayMs > 0 ? new Promise(resolve => setTimeout(resolve, delayMs)) : Promise.resolve();
}

function responseError(code, message, retryable = false) {
  const error = updateError(code, message);
  error.retryable = retryable;
  return error;
}

async function requestPart(url, partialFile, startAt, options) {
  const requestImpl = options.requestImpl || https.request;
  const headers = { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity', 'User-Agent': `JustFun-Updater/${options.clientVersion || 'unknown'}` };
  if (startAt > 0) headers.Range = `bytes=${startAt}-`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(value);
    };
    const request = requestImpl(url, { method: 'GET', headers, signal: options.signal }, async response => {
      try {
        const status = Number(response.statusCode || 0);
        if ([429, 500, 502, 503, 504].includes(status)) {
          response.resume();
          throw responseError('UPDATE_DOWNLOAD_SERVER', `Payload server returned HTTP ${status}.`, true);
        }
        if (status >= 300 && status < 400) {
          response.resume();
          throw responseError('UPDATE_DOWNLOAD_REDIRECT', 'Payload redirects are not accepted; the signed catalog must contain the final URL.');
        }
        if (![200, 206].includes(status)) {
          response.resume();
          throw responseError('UPDATE_DOWNLOAD_HTTP', `Payload server returned HTTP ${status}.`);
        }
        if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          response.resume();
          throw responseError('UPDATE_DOWNLOAD_ENCODING', 'Compressed HTTP transfer encoding is not accepted.');
        }
        let effectiveStart = startAt;
        let flags = 'a';
        if (status === 200) { effectiveStart = 0; flags = 'w'; }
        if (status === 206) {
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(response.headers['content-range'] || ''));
          if (!match || Number(match[1]) !== startAt || Number(match[3]) !== options.expectedBytes || Number(match[2]) < Number(match[1])) {
            response.resume();
            throw responseError('UPDATE_DOWNLOAD_RANGE', 'Payload range response is inconsistent with the signed catalog.');
          }
        }
        const declaredLength = response.headers['content-length'] === undefined ? null : Number(response.headers['content-length']);
        if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || effectiveStart + declaredLength > options.expectedBytes)) {
          response.resume();
          throw responseError('UPDATE_DOWNLOAD_SIZE', 'Payload response exceeds the signed size.');
        }
        let received = effectiveStart;
        const limiter = new Transform({
          transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (received > options.expectedBytes || received > options.maximumPayloadBytes) return callback(responseError('UPDATE_DOWNLOAD_SIZE', 'Payload exceeds the allowed size.'));
            options.onProgress?.({ receivedBytes: received, totalBytes: options.expectedBytes });
            callback(null, chunk);
          },
        });
        await pipeline(response, limiter, fs.createWriteStream(partialFile, { flags, mode: 0o600 }));
        finish(null, received);
      } catch (error) { finish(error); }
    });
    request.once('error', error => finish(responseError('UPDATE_DOWNLOAD_NETWORK', error.message || 'Payload network request failed.', true)));
    request.setTimeout?.(options.timeoutMs, () => request.destroy(responseError('UPDATE_DOWNLOAD_TIMEOUT', 'Payload download timed out.', true)));
    request.end();
  });
}

async function downloadVerifiedPayload(input) {
  const expectedBytes = Number(input.expectedBytes);
  const maximumPayloadBytes = Number(input.maximumPayloadBytes || 2_000_000_000);
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > maximumPayloadBytes) throw updateError('UPDATE_PAYLOAD_SIZE', 'Signed payload size is invalid.');
  const expectedSha256 = String(input.expectedSha256 || '');
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw updateError('UPDATE_PAYLOAD_HASH', 'Signed payload SHA-256 is invalid.');
  const url = allowedHttpsUrl(input.url, input.allowedHosts);
  const destination = validateDestination(input.destination);
  const partialFile = `${destination}.part`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination)) {
    const destinationEntry = fs.lstatSync(destination);
    if (!destinationEntry.isFile() || destinationEntry.isSymbolicLink()) throw updateError('UPDATE_DOWNLOAD_PATH', 'Payload destination is not a regular file.');
    if (await verifyPayloadFile(destination, expectedBytes, expectedSha256)) return { path: destination, bytes: expectedBytes, sha256: expectedSha256, reused: true, attempts: 0 };
    fs.unlinkSync(destination);
  }
  const partialStat = fs.lstatSync(partialFile, { throwIfNoEntry: false });
  if (partialStat && (!partialStat.isFile() || partialStat.isSymbolicLink())) throw updateError('UPDATE_DOWNLOAD_PATH', 'Partial payload is not a regular file.');
  if (partialStat?.size > expectedBytes) fs.unlinkSync(partialFile);
  if (partialStat?.size === expectedBytes) {
    if (await verifyPayloadFile(partialFile, expectedBytes, expectedSha256)) {
      fs.renameSync(partialFile, destination);
      return { path: destination, bytes: expectedBytes, sha256: expectedSha256, reused: true, attempts: 0 };
    }
    fs.unlinkSync(partialFile);
  }
  const maxAttempts = Math.max(1, Math.min(10, Number(input.maxAttempts || 3)));
  const baseRetryDelayMs = Math.max(0, Math.min(60_000, Number(input.baseRetryDelayMs ?? 1000)));
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    const startAt = fs.statSync(partialFile, { throwIfNoEntry: false })?.size || 0;
    try {
      await requestPart(url, partialFile, startAt, {
        expectedBytes,
        maximumPayloadBytes,
        timeoutMs: Math.max(1000, Math.min(10 * 60_000, Number(input.timeoutMs || 60_000))),
        requestImpl: input.requestImpl,
        signal: input.signal,
        clientVersion: input.clientVersion,
        onProgress: input.onProgress,
      });
      const size = fs.statSync(partialFile, { throwIfNoEntry: false })?.size || 0;
      if (size < expectedBytes) throw responseError('UPDATE_DOWNLOAD_INCOMPLETE', 'Payload download ended before the signed size.', true);
      if (size !== expectedBytes) throw responseError('UPDATE_DOWNLOAD_SIZE', 'Downloaded payload size differs from the signed catalog.');
      const digest = await sha256File(partialFile);
      if (digest !== expectedSha256) throw responseError('UPDATE_DOWNLOAD_HASH', 'Downloaded payload SHA-256 differs from the signed catalog.');
      fs.renameSync(partialFile, destination);
      return { path: destination, bytes: expectedBytes, sha256: digest, reused: false, attempts: attempt };
    } catch (error) {
      if (!error?.retryable || attempt >= maxAttempts) {
        if (['UPDATE_DOWNLOAD_SIZE', 'UPDATE_DOWNLOAD_HASH', 'UPDATE_DOWNLOAD_RANGE', 'UPDATE_DOWNLOAD_ENCODING'].includes(error?.code)) {
          try { fs.unlinkSync(partialFile); } catch {}
        }
        throw error;
      }
      await wait(baseRetryDelayMs * (2 ** (attempt - 1)));
    }
  }
  throw updateError('UPDATE_DOWNLOAD_FAILED', 'Payload download failed.');
}

module.exports = { allowedHttpsUrl, validateDestination, sha256File, verifyPayloadFile, downloadVerifiedPayload };
