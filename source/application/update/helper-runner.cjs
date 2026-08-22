'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { operationId } = require('./plan.cjs');
const { updateError } = require('./catalog.cjs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifiedHelperCopy(input) {
  const identity = input.identity;
  if (!identity || identity.schema_version !== 1 || identity.file_name !== 'JustFun-UpdateHelper.exe' || !Number.isSafeInteger(identity.bytes) || identity.bytes < 1 || !/^[0-9a-f]{64}$/.test(identity.sha256 || '')) throw updateError('UPDATE_HELPER_IDENTITY', 'Update Helper build identity is unavailable.');
  const source = path.resolve(input.installedHelper);
  const stat = fs.lstatSync(source, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== identity.bytes || sha256(source) !== identity.sha256) throw updateError('UPDATE_HELPER_TAMPERED', 'Installed Update Helper failed integrity verification.');
  const updateRoot = path.resolve(input.updateRoot);
  const directory = path.join(updateRoot, 'helper', identity.sha256);
  const destination = path.join(directory, identity.file_name);
  fs.mkdirSync(directory, { recursive: true });
  for (const candidate of [updateRoot, path.join(updateRoot, 'helper'), directory]) {
    const entry = fs.lstatSync(candidate);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw updateError('UPDATE_HELPER_PATH', 'Update Helper cache path is not a regular directory.');
  }
  if (fs.existsSync(destination)) {
    const existing = fs.lstatSync(destination);
    if (!existing.isFile() || existing.isSymbolicLink() || existing.size !== identity.bytes || sha256(destination) !== identity.sha256) throw updateError('UPDATE_HELPER_CACHE_TAMPERED', 'Cached Update Helper failed integrity verification.');
    return destination;
  }
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
  if (fs.statSync(temporary).size !== identity.bytes || sha256(temporary) !== identity.sha256) {
    try { fs.unlinkSync(temporary); } catch {}
    throw updateError('UPDATE_HELPER_COPY', 'Copied Update Helper failed integrity verification.');
  }
  fs.renameSync(temporary, destination);
  return destination;
}

function runHelperPhase(input) {
  const id = operationId(input.operationId);
  if (!['prepare', 'apply', 'recover'].includes(input.phase)) throw updateError('UPDATE_HELPER_PHASE', 'Update Helper phase is invalid.');
  const spawn = input.spawnImpl || childProcess.spawn;
  const detached = input.phase === 'apply' || input.phase === 'recover';
  const child = spawn(input.helperPath, [`--${input.phase}`, `--operation=${id}`], { shell: false, windowsHide: true, detached, stdio: 'ignore' });
  if (detached) {
    child.unref?.();
    return Promise.resolve({ started: true, pid: child.pid || null });
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill?.();
      reject(updateError('UPDATE_HELPER_TIMEOUT', 'Update Helper preparation timed out.'));
    }, Math.max(30_000, Math.min(15 * 60_000, Number(input.timeoutMs || 10 * 60_000))));
    child.once('error', error => { clearTimeout(timeout); reject(updateError('UPDATE_HELPER_START', error.message || 'Update Helper could not start.')); });
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolve({ started: true, exitCode: 0 });
      else reject(updateError('UPDATE_HELPER_FAILED', `Update Helper preparation returned ${String(code)}.`));
    });
  });
}

module.exports = { sha256, verifiedHelperCopy, runHelperPhase };
