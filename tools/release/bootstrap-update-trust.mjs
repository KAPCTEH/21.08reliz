import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || !value) fail(`Invalid argument near ${name || '<end>'}.`);
    values.set(name.slice(2), value);
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
const trustStoreInput = String(args.get('trust-store') || '').trim();
const privateKeyInput = String(args.get('private-key-path') || '').trim();
const keyId = String(args.get('key-id') || '');

if (!trustStoreInput) fail('The trust store path is required.');
if (!privateKeyInput) fail('The protected private-key path is required.');
const trustStorePath = path.resolve(trustStoreInput);
const privateKeyPath = path.resolve(privateKeyInput);
if (!fs.existsSync(trustStorePath)) fail('The trust store is missing.');
if (!/^[A-Za-z0-9._-]{1,80}$/.test(keyId)) fail('The key id is invalid.');

const trustStore = JSON.parse(fs.readFileSync(trustStorePath, 'utf8'));
if (trustStore?.schema_version !== 1 || !Array.isArray(trustStore.keys)) fail('The trust store format is invalid.');
if (trustStore.keys.length !== 0) fail('Initial trust is allowed only while the trust store is empty.');
if (fs.existsSync(privateKeyPath)) fail('The private-key destination already exists.');

fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true, mode: 0o700 });
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' });
const publicDer = publicKey.export({ format: 'der', type: 'spki' });
fs.writeFileSync(privateKeyPath, privatePem, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

const publicEntry = {
  key_id: keyId,
  algorithm: 'Ed25519',
  status: 'active',
  public_key_spki_base64: publicDer.toString('base64'),
};
const metadata = {
  schema_version: 1,
  key_id: keyId,
  algorithm: 'Ed25519',
  public_spki_sha256: crypto.createHash('sha256').update(publicDer).digest('hex'),
  created_at_utc: new Date().toISOString(),
  private_key_path: privateKeyPath,
};
fs.writeFileSync(`${privateKeyPath}.public.json`, `${JSON.stringify(metadata, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

if (process.platform === 'win32') {
  try {
    const identity = childProcess.execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding:'utf8', windowsHide:true });
    const sid = identity.match(/S-\d+(?:-\d+)+/)?.[0];
    if (!sid) throw new Error('Current Windows SID was not returned.');
    for (const file of [privateKeyPath, `${privateKeyPath}.public.json`]) {
      childProcess.execFileSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`, '*S-1-5-18:(F)'], { stdio:'pipe', windowsHide:true });
    }
  } catch (error) {
    fs.rmSync(privateKeyPath, { force:true });
    fs.rmSync(`${privateKeyPath}.public.json`, { force:true });
    fail(`Could not protect the release key with a private Windows ACL: ${error.message}`);
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, public_entry: publicEntry, metadata }, null, 2)}\n`);
