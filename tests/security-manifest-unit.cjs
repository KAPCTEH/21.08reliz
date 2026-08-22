'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  sha256File,
  verifySecurityManifestFiles,
} = require('../source/application/security-manifest.cjs');
const release = require('../source/application/release.json');

function integrityFixture(root) {
  const archivePath = path.join(root, 'app.asar');
  const manifestPath = path.join(root, 'justfun-security.json');
  fs.writeFileSync(archivePath, Buffer.from('verified archive fixture'));
  const manifest = {
    schema: 3,
    generated_at: '2026-08-09T00:00:00.000Z',
    archive: 'app.asar',
    archive_sha256: sha256File(archivePath),
    archive_header_sha256: 'A'.repeat(64),
    windows_integrity_resource: 'INTEGRITY/ELECTRONASAR',
    executable_branding: `${release.product_name} ${release.version}`,
    loose_application_directory_present: false,
    fuses: 'fixture',
    integrity_model: 'electron-asar-header-sha256',
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return {archivePath, manifestPath, manifest};
}

function expectedCode(code, action) {
  assert.throws(action, error => error?.code === code);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'justfun-security-manifest-'));
try {
  const fixture = integrityFixture(root);
  const verified = verifySecurityManifestFiles(fixture);
  assert.equal(verified.ok, true);
  assert.equal(verified.integrityModel, 'electron-asar-header-sha256');
  assert.equal(verified.archiveHashVerified, true);

  const changedManifest = {...fixture.manifest, integrity_model:'unsupported'};
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(changedManifest));
  expectedCode('SECURITY_MANIFEST_MODEL', () => verifySecurityManifestFiles(fixture));

  fs.writeFileSync(fixture.manifestPath, JSON.stringify(fixture.manifest));
  fs.appendFileSync(fixture.archivePath, 'tampered');
  expectedCode('SECURITY_ARCHIVE_TAMPERED', () => verifySecurityManifestFiles(fixture));

  fs.writeFileSync(fixture.archivePath, Buffer.from('verified archive fixture'));
  fs.mkdirSync(path.join(root, 'app'));
  expectedCode('SECURITY_LOOSE_APPLICATION', () => verifySecurityManifestFiles({...fixture, looseApplicationPath:path.join(root, 'app')}));

  process.stdout.write(`${JSON.stringify({ok:true, checks:4})}\n`);
} finally {
  fs.rmSync(root, {recursive:true, force:true});
}
