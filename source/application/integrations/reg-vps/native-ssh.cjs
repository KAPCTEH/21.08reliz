'use strict';

const RELEASE = require('../../release.json');

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;
const SSH_READY_TIMEOUT_MS = 10 * 60 * 1000;

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

function sftpCall(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    sftp[method](...args, error => error ? reject(error) : resolve());
  });
}

function normalizeShellScript(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function connect(options, confirmFingerprint) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    client.once('ready', () => finish(resolve, client));
    client.once('error', error => finish(reject, error));
    client.connect({
      host: options.host,
      port: options.port,
      username: options.username,
      password: options.password,
      // Host verification waits for an explicit human decision. A short SSH
      // ready timeout can expire behind the still-visible fingerprint dialog.
      readyTimeout: SSH_READY_TIMEOUT_MS,
      keepaliveInterval: 15000,
      keepaliveCountMax: 4,
      algorithms: {
        serverHostKey: [
          'ssh-ed25519',
          'ecdsa-sha2-nistp521',
          'ecdsa-sha2-nistp384',
          'ecdsa-sha2-nistp256',
          'rsa-sha2-512',
          'rsa-sha2-256'
        ]
      },
      hostVerifier: (key, callback) => {
        const fingerprint = conventionalFingerprint(key);
        Promise.resolve(confirmFingerprint(fingerprint))
          .then(accepted => callback(Boolean(accepted)))
          .catch(() => callback(false));
      }
    });
  });
}

function openSftp(client) {
  return new Promise((resolve, reject) => client.sftp((error, sftp) => error ? reject(error) : resolve(sftp)));
}

function execRemote(client, command, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 45 * 60 * 1000;
  const stdin = String(options.stdin || '');
  return new Promise((resolve, reject) => {
    let output = '';
    let totalBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.end();
      reject(new Error('Установка на VPS не завершилась за 45 минут и была остановлена.'));
    }, timeoutMs);
    const append = chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
      totalBytes += buffer.length;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        settled = true;
        clearTimeout(timer);
        client.end();
        reject(new Error('VPS вернул слишком большой журнал установки.'));
        return;
      }
      output += buffer.toString('utf8');
      if (typeof options.onProgress === 'function') options.onProgress(buffer.toString('utf8'));
    };
    client.exec(command, { pty: Boolean(options.pty) }, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        settled = true;
        reject(error);
        return;
      }
      stream.on('data', append);
      stream.stderr.on('data', append);
      stream.once('close', code => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        code === 0 ? resolve(output) : reject(Object.assign(
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
  try {
    client = await connect(options, rawOptions.confirmFingerprint);
    const sftp = await openSftp(client);
    await sftpCall(sftp, 'mkdir', remoteDir, { mode: 0o700 });
    await sftpCall(sftp, 'fastPut', serverPath, `${remoteDir}/server.py`, { mode: 0o600 });
    await sftpCall(sftp, 'writeFile', `${remoteDir}/install.sh`, installerPayload, { mode: 0o700 });
    await sftpCall(sftp, 'writeFile', `${remoteDir}/${bootstrapName}`, bootstrap, { mode: 0o600 });
    await sftpCall(sftp, 'chmod', `${remoteDir}/install.sh`, 0o700);
    await sftpCall(sftp, 'chmod', `${remoteDir}/${bootstrapName}`, 0o600);
    sftp.end();

    const installCommand = options.username === 'root'
      ? `bash '${remoteDir}/install.sh' '${remoteDir}/${bootstrapName}'`
      : `sudo -S -p '' bash '${remoteDir}/install.sh' '${remoteDir}/${bootstrapName}'`;
    const output = await execRemote(client, installCommand, {
      pty: options.username !== 'root',
      stdin: options.username === 'root' ? '' : `${options.password}\n`,
      onProgress: rawOptions.onProgress
    });
    const match = output.match(/(?:^|\r?\n)CERT_SHA256=([A-Fa-f0-9]{64})(?:\r?\n|$)/);
    if (!match) throw new Error('VPS не вернул подтверждённый отпечаток TLS-сертификата.');
    return {
      format: 2,
      version: RELEASE.version,
      address: options.host,
      ssh_user: options.username,
      ssh_port: options.port,
      ssh_host_sha256: String(rawOptions.acceptedFingerprint || ''),
      api_port: 443,
      workspace_id: options.installationId,
      tls_sha256: match[1].toUpperCase(),
      configured_at: new Date().toISOString()
    };
  } finally {
    if (client) {
      await cleanupRemote(client, remoteDir);
      client.end();
    }
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
