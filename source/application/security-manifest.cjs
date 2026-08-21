'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Electron replaces ordinary fs access for paths containing .asar so files
// inside the archive can be read transparently. Hashing the archive itself
// must bypass that virtual layer; otherwise app.asar is treated as a folder.
let rawFs = fs;
try { rawFs = require('original-fs'); }
catch (_error) { rawFs = fs; }

const SECURITY_MANIFEST_SCHEMA = 3;
const SECURITY_MANIFEST_NAME = 'justfun-security.json';

function integrityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const descriptor = rawFs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const bytes = rawFs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    rawFs.closeSync(descriptor);
  }
  return hash.digest('hex').toUpperCase();
}

function readManifest(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw integrityError('SECURITY_MANIFEST_READ', `Паспорт защиты отсутствует или повреждён: ${error.message}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw integrityError('SECURITY_MANIFEST_FORMAT', 'Паспорт защиты имеет неверный формат.');
  }
  return manifest;
}

function verifySecurityManifestFiles({manifestPath, archivePath, looseApplicationPath=''}) {
  const manifest = readManifest(manifestPath);
  if (manifest.schema !== SECURITY_MANIFEST_SCHEMA) {
    throw integrityError('SECURITY_MANIFEST_SCHEMA', `Неподдерживаемая версия паспорта защиты: ${String(manifest.schema)}.`);
  }
  if (manifest.archive !== 'app.asar') {
    throw integrityError('SECURITY_MANIFEST_ARCHIVE', 'Паспорт защиты ссылается не на app.asar.');
  }
  if (manifest.integrity_model !== 'electron-asar-header-sha256') {
    throw integrityError('SECURITY_MANIFEST_MODEL', 'Паспорт защиты использует неподдерживаемую модель целостности.');
  }
  if (!/^[A-F0-9]{64}$/.test(String(manifest.archive_sha256 || ''))
      || !/^[A-F0-9]{64}$/.test(String(manifest.archive_header_sha256 || ''))
      || manifest.windows_integrity_resource !== 'INTEGRITY/ELECTRONASAR') {
    throw integrityError('SECURITY_MANIFEST_FIELDS', 'В паспорте защиты отсутствуют обязательные поля целостности.');
  }
  if (looseApplicationPath && fs.existsSync(looseApplicationPath)) {
    throw integrityError('SECURITY_LOOSE_APPLICATION', 'Обнаружена незапакованная копия приложения.');
  }
  if (!fs.existsSync(archivePath)) {
    throw integrityError('SECURITY_ARCHIVE_MISSING', 'Защищённый архив app.asar отсутствует.');
  }
  const actualArchiveHash = sha256File(archivePath);
  if (actualArchiveHash !== manifest.archive_sha256) {
    throw integrityError('SECURITY_ARCHIVE_TAMPERED', 'Хеш app.asar не совпадает с подписанным паспортом защиты.');
  }
  return {
    ok: true,
    schema: manifest.schema,
    integrityModel: manifest.integrity_model,
    archiveHashVerified: true,
    archiveSha256: actualArchiveHash,
  };
}

function verifyPackagedApplicationIntegrity({applicationDirectory, requirePackaged=false} = {}) {
  const appDirectory = path.resolve(String(applicationDirectory || __dirname));
  const packaged = path.basename(appDirectory).toLowerCase() === 'app.asar';
  if (!packaged) {
    if (requirePackaged) throw integrityError('SECURITY_PACKAGE_REQUIRED', 'Запущена незапакованная версия приложения.');
    return {ok:true, packaged:false, developmentMode:true};
  }
  const resourcesDirectory = path.dirname(appDirectory);
  const result = verifySecurityManifestFiles({
    manifestPath: path.join(resourcesDirectory, SECURITY_MANIFEST_NAME),
    archivePath: appDirectory,
    looseApplicationPath: path.join(resourcesDirectory, 'app'),
  });
  return {...result, packaged:true, resourcesDirectory};
}

module.exports = {
  SECURITY_MANIFEST_SCHEMA,
  sha256File,
  verifySecurityManifestFiles,
  verifyPackagedApplicationIntegrity,
};
