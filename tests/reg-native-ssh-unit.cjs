'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const application = path.join(root, 'source', 'application');
const mainSource = fs.readFileSync(path.join(application, 'main.js'), 'utf8');
const nativeSource = fs.readFileSync(path.join(application, 'integrations', 'reg-vps', 'native-ssh.cjs'), 'utf8');
const installerSource = fs.readFileSync(path.join(application, 'integrations', 'reg-vps', 'server', 'install.sh'), 'utf8');
const native = require(path.join(application, 'integrations', 'reg-vps', 'native-ssh.cjs'));

assert.strictEqual(
  native.conventionalFingerprint(Buffer.from('justfun-test-host-key')),
  'SHA256:3unQW+0eb6zyGVTPV+2NTG81+BShUNWjVWhVA/mzbbg'
);

const valid = native.validateOptions({
  host: '203.0.113.10',
  username: 'root',
  port: 22,
  password: 'not-a-real-password',
  installationId: 'company_1234567890',
  apiKey: 'A'.repeat(64),
  attestationSecret: `jfvps_${'B'.repeat(48)}`
});
assert.strictEqual(valid.host, '203.0.113.10');
assert.strictEqual(valid.username, 'root');
assert.strictEqual(native.normalizeShellScript('\uFEFF#!/usr/bin/env bash\r\nset -euo pipefail\r\n'), '#!/usr/bin/env bash\nset -euo pipefail\n');
assert.throws(() => native.validateOptions({...valid, password:'line\nbreak'}), /SSH-пароль/);
assert.throws(() => native.validateOptions({...valid, username:'Root!'}), /SSH-пользователя/);
assert.throws(() => native.validateOptions({...valid, port:70000}), /SSH-порт/);
assert.throws(() => native.validateOptions({...valid, attestationSecret:'jfvps_short'}), /подтверждения VPS/);

for (const [label, pattern] of [
  ['powershell.exe', /powershell\.exe/i],
  ['pwsh.exe', /pwsh\.exe/i],
  ['cmd.exe', /cmd\.exe/i],
  ['.ps1', /\.ps1(?![a-z0-9])/i],
  ['.bat', /\.bat(?![a-z0-9])/i],
  ['.cmd', /\.cmd(?![a-z0-9])/i]
]) {
  assert(!pattern.test(mainSource), `main.js contains forbidden script host: ${label}`);
  assert(!pattern.test(nativeSource), `native-ssh.cjs contains forbidden script host: ${label}`);
}
assert(!fs.existsSync(path.join(application, 'integrations', 'reg-vps', 'setup-reg-vps.ps1')));
assert(mainSource.includes('confirmRegVpsFingerprint'));
assert(mainSource.includes('ssh_host_sha256'));
assert(mainSource.includes('openRegVpsPasswordWindow'));
assert(nativeSource.includes('hostVerifier'));
assert(nativeSource.includes('const SSH_PROBE_TIMEOUT_MS = 15 * 1000'));
assert(nativeSource.includes('const SSH_CONNECT_TIMEOUT_MS = 30 * 1000'));
assert(nativeSource.includes('const fingerprint = await probeFingerprint(options, runtime)'));
assert(nativeSource.includes('client = await connect(options, fingerprint, runtime)'));
assert(nativeSource.includes("client.on('close'"));
assert(nativeSource.includes("client.on('end'"));
assert(nativeSource.includes('sudo -S -p'));
assert(nativeSource.includes('mode: 0o600'));
assert(nativeSource.includes("sftpCall(sftp, runtime, 'writeFile', `${remoteDir}/install.sh`, installerPayload"));
assert(!nativeSource.includes("sftpCall(sftp, runtime, 'fastPut', installerPath"));
assert(nativeSource.includes('VPS_ATTESTATION_SECRET_B64='));
assert(mainSource.includes('attestation_secret:attestationSecret'));
assert(installerSource.includes("<<'EOF_NGINX'"));
assert(installerSource.includes('proxy_set_header Host $host;'));
assert(installerSource.includes('rollback_installation()'));
assert(installerSource.includes('previous server state restored after setup failure'));
assert(installerSource.includes('pg_dump --format=custom orderslogistics'));
assert(installerSource.includes('install -d -o root -g postgres -m 0710 /var/backups/justfun-orders-logistics'));
assert(installerSource.includes('install -d -m 0710 -o root -g postgres "$BACKUP_DIR"'));
assert(installerSource.includes('chmod 0640 "$BACKUP_DIR/orderslogistics.dump"'));

console.log('REG.RU native SSH unit tests: PASS');
