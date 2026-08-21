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
  apiKey: 'A'.repeat(64)
});
assert.strictEqual(valid.host, '203.0.113.10');
assert.strictEqual(valid.username, 'root');
assert.throws(() => native.validateOptions({...valid, password:'line\nbreak'}), /SSH-пароль/);
assert.throws(() => native.validateOptions({...valid, username:'Root!'}), /SSH-пользователя/);
assert.throws(() => native.validateOptions({...valid, port:70000}), /SSH-порт/);

for (const token of ['powershell.exe', 'pwsh.exe', 'cmd.exe', '.ps1', '.bat', '.cmd']) {
  assert(!mainSource.toLowerCase().includes(token), `main.js contains forbidden script host: ${token}`);
  assert(!nativeSource.toLowerCase().includes(token), `native-ssh.cjs contains forbidden script host: ${token}`);
}
assert(!fs.existsSync(path.join(application, 'integrations', 'reg-vps', 'setup-reg-vps.ps1')));
assert(mainSource.includes('confirmRegVpsFingerprint'));
assert(mainSource.includes('ssh_host_sha256'));
assert(mainSource.includes('openRegVpsPasswordWindow'));
assert(nativeSource.includes('hostVerifier'));
assert(nativeSource.includes('sudo -S -p'));
assert(nativeSource.includes('mode: 0o600'));
assert(installerSource.includes("<<'EOF_NGINX'"));
assert(installerSource.includes('proxy_set_header Host $host;'));
assert(installerSource.includes('rollback_installation()'));
assert(installerSource.includes('previous server state restored after setup failure'));
assert(installerSource.includes('pg_dump --format=custom orderslogistics'));

console.log('REG.RU native SSH unit tests: PASS');
