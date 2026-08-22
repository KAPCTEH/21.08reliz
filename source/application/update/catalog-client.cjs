'use strict';

const https = require('https');
const { updateError } = require('./catalog.cjs');

function validateCatalogUrl(input, allowedHosts) {
  let url;
  try { url = new URL(String(input || '')); }
  catch { throw updateError('UPDATE_CATALOG_URL', 'Update catalog URL is invalid.'); }
  const hosts = new Set((allowedHosts || []).map(host => String(host).toLowerCase()));
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) throw updateError('UPDATE_CATALOG_URL', 'Update catalog must use credential-free HTTPS on the standard port without a fragment.');
  if (!hosts.has(url.hostname.toLowerCase())) throw updateError('UPDATE_CATALOG_HOST', 'Update catalog host is not allowed.');
  return url;
}

function fetchCatalogJson(input) {
  const url = validateCatalogUrl(input.url, input.allowedHosts);
  const maximumBytes = Math.max(1024, Math.min(1024 * 1024, Number(input.maximumBytes || 256 * 1024)));
  const requestImpl = input.requestImpl || https.request;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(result);
    };
    const request = requestImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', 'User-Agent': `JustFun-Updater/${input.clientVersion || 'unknown'}` },
      signal: input.signal,
    }, response => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400) {
        response.resume();
        return finish(updateError('UPDATE_CATALOG_REDIRECT', 'Catalog redirects are not accepted.'));
      }
      if (status !== 200) {
        response.resume();
        return finish(updateError('UPDATE_CATALOG_HTTP', `Catalog server returned HTTP ${status}.`));
      }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.resume();
        return finish(updateError('UPDATE_CATALOG_ENCODING', 'Compressed catalog transfer is not accepted.'));
      }
      const declared = response.headers['content-length'] === undefined ? null : Number(response.headers['content-length']);
      if (declared !== null && (!Number.isSafeInteger(declared) || declared < 2 || declared > maximumBytes)) {
        response.resume();
        return finish(updateError('UPDATE_CATALOG_SIZE', 'Catalog response size is invalid.'));
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maximumBytes) {
          response.destroy(updateError('UPDATE_CATALOG_SIZE', 'Catalog exceeds the allowed size.'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', error => finish(error?.code?.startsWith('UPDATE_') ? error : updateError('UPDATE_CATALOG_NETWORK', error.message || 'Catalog response failed.')));
      response.once('end', () => {
        if (bytes < 2) return finish(updateError('UPDATE_CATALOG_SIZE', 'Catalog response is empty.'));
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''))); }
        catch { finish(updateError('UPDATE_CATALOG_JSON', 'Catalog response is not valid JSON.')); }
      });
    });
    request.once('error', error => finish(error?.code?.startsWith('UPDATE_') ? error : updateError('UPDATE_CATALOG_NETWORK', error.message || 'Catalog request failed.')));
    request.setTimeout?.(Math.max(1000, Math.min(120_000, Number(input.timeoutMs || 30_000))), () => request.destroy(updateError('UPDATE_CATALOG_TIMEOUT', 'Catalog request timed out.')));
    request.end();
  });
}

module.exports = { validateCatalogUrl, fetchCatalogJson };
