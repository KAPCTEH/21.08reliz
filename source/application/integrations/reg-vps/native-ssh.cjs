'use strict';

const RELEASE = require('../../release.json');

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const SSH_PROBE_TIMEOUT_MS = 15 * 1000;
const SSH_CONNECT_TIMEOUT_MS = 30 * 1000;

const SSH_ALGORITHMS = Object.freeze({
  serverHostKey: [
    'ssh-ed25519',
    'ecdsa-sha2-nistp521',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp256',
    'rsa-sha2-512',
    'rsa-sha2-256'
  ]
});

function cancellationError(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('Учётная запись изменилась во время настройки VPS.'), {code: 'AUTH_SESSION_CHANGED'});
}

function assertRuntimeActive(runtime = {}) {
  if (runtime.signal?.aborted) throw cancellationError(runtime.signal);
  if (typeof runtime.guard === 'function') runtime.guard();
  if (runtime.signal?.aborted) throw cancellationError(runtime.signal);
}

function terminateClient(client) {
  try { client?.end?.(); } catch {}
  try { client?.destroy?.(); } catch {}
}

function conventionalFingerprint(key) {
  return `SHA256:${crypto.createHash('sha256').update(key).digest('base64').replace(/=+$/g, '')}`;
}

function validateOptions(options) {
  const host = String(options?.host || '').trim();
  const username = String(options?.username || '').trim();
  const port = Number(options?.port || 22);
  const password = String(options?.password || '');
  const installationId = String(options?.installationId || '');
  const apiKey = String(options?.apiKey || '');
  const attestationSecret = String(options?.attestationSecret || '');
  if (!host) throw new Error('Не указан адрес VPS.');
  if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(username)) throw new Error('Проверьте имя SSH-пользователя.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Проверьте SSH-порт.');
  if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) throw new Error('Введите SSH-пароль.');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(installationId)) throw new Error('Идентификатор компании повреждён.');
  if (!/^[A-Za-z0-9_-]{40,120}$/.test(apiKey)) throw new Error('Временный ключ подключения повреждён.');
  if (!/^jfvps_[A-Za-z0-9_-]{43,120}$/.test(attestationSecret)) throw new Error('Ключ подтверждения VPS повреждён.');
  return { host, username, port, password, installationId, apiKey, attestationSecret };
}

function b64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function sftpCall(sftp, runtime, method, ...args) {
  assertRuntimeActive(runtime);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      runtime.signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      try { sftp?.end?.(); } catch {}
      finish(reject, cancellationError(runtime.signal));
    };
    runtime.signal?.addEventListener?.('abort', onAbort, {once: true});
    sftp[method](...args, error => {
      if (error) { finish(reject, error); return; }
      try { assertRuntimeActive(runtime); finish(resolve); }
      catch (guardError) { finish(reject, guardError); }
    });
  });
}

function normalizeShellScript(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function fingerprintMatches(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function probeFingerprint(options, runtime = {}) {
  assertRuntimeActive(runtime);
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      runtime.signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      terminateClient(client);
      finish(reject, cancellationError(runtime.signal));
    };
    const timer = setTimeout(() => {
      try { client.end(); } catch {}
      finish(reject, new Error('VPS не передал SSH-ключ за 15 секунд. Проверьте адрес, порт и доступность сервера.'));
    }, SSH_PROBE_TIMEOUT_MS);
    client.on('error', error => finish(reject, error));
    client.on('close', () => finish(reject, new Error('VPS закрыл соединение до получения SSH-ключа.')));
    runtime.signal?.addEventListener?.('abort', onAbort, {once: true});
    try {
      client.connect({
        host: options.host,
        port: options.port,
        username: options.username,
        readyTimeout: SSH_PROBE_TIMEOUT_MS,
        algorithms: SSH_ALGORITHMS,
        // The password is deliberately absent here. The first connection only
        // reads the host key and is closed before the human confirmation.
        hostVerifier: (key, callback) => {
          try {
            assertRuntimeActive(runtime);
            const fingerprint = conventionalFingerprint(key);
            finish(resolve, fingerprint);
            callback(false);
          } catch (error) {
            finish(reject, error);
            callback(false);
          }
          setImmediate(() => {
            try { client.end(); } catch {}
          });
        }
      });
    } catch (error) {
      finish(reject, error);
    }
  });
}

function connect(options, acceptedFingerprint, runtime = {}) {
  assertRuntimeActive(runtime);
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      runtime.signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const onAbort = () => {
      terminateClient(client);
      finish(reject, cancellationError(runtime.signal));
    };
    const timer = setTimeout(() => {
      try { client.end(); } catch {}
      finish(reject, new Error('VPS не завершил SSH-вход за 30 секунд. Проверьте пароль и настройки SSH.'));
    }, SSH_CONNECT_TIMEOUT_MS);
    client.once('ready', () => {
      try { assertRuntimeActive(runtime); finish(resolve, client); }
      catch (error) { terminateClient(client); finish(reject, error); }
    });
    client.on('error', error => finish(reject, error));
    client.on('close', () => finish(reject, new Error('VPS закрыл SSH-соединение до завершения входа.')));
    client.on('end', () => finish(reject, new Error('SSH-соединение завершилось до подтверждения входа.')));
    runtime.signal?.addEventListener?.('abort', onAbort, {once: true});
    try {
      client.connect({
        host: options.host,
        port: options.port,
        username: options.username,
        password: options.password,
        readyTimeout: SSH_CONNECT_TIMEOUT_MS,
        keepaliveInterval: 15000,
        keepaliveCountMax: 4,
        algorithms: SSH_ALGORITHMS,
        hostVerifier: (key, callback) => {
          const fingerprint = conventionalFingerprint(key);
          callback(fingerprintMatches(fingerprint, acceptedFingerprint));
        }
      });
    } catch (error) {
      finish(reject, error);
    }
  });
}

function openSftp(client, runtime = {}) {
  assertRuntimeActive(runtime);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      runtime.signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const onAbort = () => { terminateClient(client); finish(reject, cancellationError(runtime.signal)); };
    runtime.signal?.addEventListener?.('abort', onAbort, {once: true});
    client.sftp((error, sftp) => {
      if (error) { finish(reject, error); return; }
      try { assertRuntimeActive(runtime); finish(resolve, sftp); }
      catch (guardError) { try { sftp?.end?.(); } catch {} finish(reject, guardError); }
    });
  });
}

function execRemote(client, command, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 45 * 60 * 1000;
  const stdin = String(options.stdin || '');
  assertRuntimeActive(options);
  return new Promise((resolve, reject) => {
    let output = '';
    let totalBytes = 0;
    let settled = false;
    let stream = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    const stop = error => {
      try { stream?.close?.(); } catch {}
      try { stream?.end?.(); } catch {}
      terminateClient(client);
      finish(reject, error);
    };
    const onAbort = () => stop(cancellationError(options.signal));
    const timer = setTimeout(() => {
      stop(new Error('Установка на VPS не завершилась за 45 минут и была остановлена.'));
    }, timeoutMs);
    options.signal?.addEventListener?.('abort', onAbort, {once: true});
    const append = chunk => {
      if (settled) return;
      try { assertRuntimeActive(options); }
      catch (error) { stop(error); return; }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      totalBytes += buffer.length;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        stop(new Error('VPS вернул слишком большой журнал установки.'));
        return;
      }
      output += buffer.toString('utf8');
      if (typeof options.onProgress === 'function') options.onProgress(buffer.toString('utf8'));
    };
    client.exec(command, { pty: Boolean(options.pty) }, (error, openedStream) => {
      if (settled) { try { openedStream?.close?.(); } catch {} return; }
      if (error) {
        finish(reject, error);
        return;
      }
      stream = openedStream;
      stream.on('data', append);
      stream.stderr.on('data', append);
      stream.once('close', code => {
        if (settled) return;
        try { assertRuntimeActive(options); }
        catch (error) { finish(reject, error); return; }
        code === 0 ? finish(resolve, output) : finish(reject, Object.assign(
          new Error(`Установка на VPS завершилась с кодом ${code}. Действующая база не удалена.`),
          { remoteOutput: output.slice(-12000), exitCode: code }
        ));
      });
      if (stdin) stream.write(stdin);
    });
  });
}

async function cleanupRemote(client, remoteDir) {
  try {
    await execRemote(client, `rm -rf -- '${remoteDir}'`, { timeoutMs: 30000 });
  } catch {
    // The remote directory has a random, locally generated name and is also
    // protected by mode 0700. A failed best-effort cleanup is non-fatal.
  }
}

async function installRegVps(rawOptions) {
  const options = validateOptions(rawOptions);
  const runtime = {signal: rawOptions?.signal, guard: rawOptions?.guard};
  assertRuntimeActive(runtime);
  const packageRoot = path.resolve(String(rawOptions.packageRoot || ''));
  const serverPath = path.join(packageRoot, 'server.py');
  const installerPath = path.join(packageRoot, 'install.sh');
  if (!fs.statSync(serverPath, { throwIfNoEntry: false })?.isFile() ||
      !fs.statSync(installerPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error('В программе отсутствуют компоненты установки VPS. Переустановите JustFun.');
  }
  if (typeof rawOptions.confirmFingerprint !== 'function') throw new Error('Не настроена проверка отпечатка SSH.');
  const installerPayload = Buffer.from(normalizeShellScript(fs.readFileSync(installerPath, 'utf8')), 'utf8');

  const nonce = crypto.randomBytes(18).toString('hex');
  const remoteDir = `/tmp/justfun-orders-${nonce}`;
  const bootstrapName = `bootstrap-${nonce}.env`;
  const bootstrap = [
    `API_KEY_B64=${b64(options.apiKey)}`,
    `VPS_ATTESTATION_SECRET_B64=${b64(options.attestationSecret)}`,
    `INSTALLATION_ID_B64=${b64(options.installationId)}`,
    `SERVER_IP_B64=${b64(options.host)}`,
    `SSH_PORT_B64=${b64(String(options.port))}`,
    ''
  ].join('\n');

  let client = null;
  let abortClient = null;
  try {
    const fingerprint = await probeFingerprint(options, runtime);
    assertRuntimeActive(runtime);
    const accepted = await Promise.resolve(rawOptions.confirmFingerprint(fingerprint));
    assertRuntimeActive(runtime);
    if (!accepted) throw Object.assign(
      new Error('Подключение отменено: SSH-ключ VPS не подтверждён.'),
      { code: 'SSH_FINGERPRINT_REJECTED' }
    );
    client = await connect(options, fingerprint, runtime);
    assertRuntimeActive(runtime);
    abortClient = () => terminateClient(client);
    runtime.signal?.addEventListener?.('abort', abortClient, {once: true});
    const sftp = await openSftp(client, runtime);
    assertRuntimeActive(runtime);
    await sftpCall(sftp, runtime, 'mkdir', remoteDir, { mode: 0o700 });
    await sftpCall(sftp, runtime, 'fastPut', serverPath, `${remoteDir}/server.py`, { mode: 0o600 });
    await sftpCall(sftp, runtime, 'writeFile', `${remoteDir}/install.sh`, installerPayload, { mode: 0o700 });
    await sftpCall(sftp, runtime, 'writeFile', `${remoteDir}/${bootstrapName}`, bootstrap, { mode: 0o600 });
    await sftpCall(sftp, runtime, 'chmod', `${remoteDir}/install.sh`, 0o700);
    await sftpCall(sftp, runtime, 'chmod', `${remoteDir}/${bootstrapName}`, 0o600);
    assertRuntimeActive(runtime);
    sftp.end();

    const installCommand = options.username === 'root'
      ? `bash '${remoteDir}/install.sh' '${remoteDir}/${bootstrapName}'`
      : `sudo -S -p '' bash '${remoteDir}/install.sh' '${remoteDir}/${bootstrapName}'`;
    assertRuntimeActive(runtime);
    const output = await execRemote(client, installCommand, {
      pty: options.username !== 'root',
      stdin: options.username === 'root' ? '' : `${options.password}\n`,
      onProgress: rawOptions.onProgress,
      signal: runtime.signal,
      guard: runtime.guard
    });
    assertRuntimeActive(runtime);
    const match = output.match(/(?:^|\r?\n)CERT_SHA256=([A-Fa-f0-9]{64})(?:\r?\n|$)/);
    if (!match) throw new Error('VPS не вернул подтверждённый отпечаток TLS-сертификата.');
    return {
      format: 2,
      version: RELEASE.service_versions.reg_api,
      address: options.host,
      ssh_user: options.username,
      ssh_port: options.port,
      ssh_host_sha256: fingerprint,
      api_port: 443,
      workspace_id: options.installationId,
      tls_sha256: match[1].toUpperCase(),
      configured_at: new Date().toISOString()
    };
  } finally {
    if (client) {
      if (!runtime.signal?.aborted) await cleanupRemote(client, remoteDir);
      terminateClient(client);
    }
    if (abortClient) runtime.signal?.removeEventListener?.('abort', abortClient);
    options.password = '';
    options.apiKey = '';
    options.attestationSecret = '';
  }
}

module.exports = Object.freeze({
  conventionalFingerprint,
  installRegVps,
  normalizeShellScript,
  validateOptions
});
