'use strict';

const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('./journal.cjs');
const { updateError } = require('./catalog.cjs');

function operationId(value) {
  const result = String(value || '');
  if (!/^[A-Za-z0-9._-]{16,128}$/.test(result)) throw updateError('UPDATE_OPERATION_ID', 'Update operation ID is invalid.');
  return result;
}

function createUpdatePlan(input) {
  const id = operationId(input.operationId);
  const installRoot = path.resolve(String(input.installRoot || ''));
  const updateRoot = path.resolve(String(input.updateRoot || ''));
  if (!path.isAbsolute(installRoot) || !path.isAbsolute(updateRoot) || installRoot === path.parse(installRoot).root || updateRoot === path.parse(updateRoot).root) throw updateError('UPDATE_PLAN_PATH', 'Update plan root path is invalid.');
  const catalog = input.catalog;
  if (!catalog?.release?.payload?.file_name) throw updateError('UPDATE_PLAN_CATALOG', 'Verified catalog is unavailable for the update plan.');
  const now = input.now instanceof Date ? input.now : new Date(input.now || Date.now());
  if (Number.isNaN(now.getTime())) throw updateError('UPDATE_PLAN_TIME', 'Update plan clock is invalid.');
  const plan = {
    schema_version: 1,
    product_id: 'justfun-logistics',
    operation_id: id,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    source_pid: Number.isSafeInteger(input.sourcePid) && input.sourcePid >= 0 ? input.sourcePid : process.pid,
    install_root: installRoot,
    staging_root: `${installRoot}.__justfun_update_stage__`,
    previous_root: `${installRoot}.__justfun_update_previous__`,
    archive_path: path.join(updateRoot, 'downloads', catalog.release.payload.file_name),
    health_confirmation_path: path.join(updateRoot, 'health', `${id}.json`),
    health_timeout_seconds: Math.max(30, Math.min(600, Number(input.healthTimeoutSeconds || 120))),
    preserve_files: ['Orders-Logistics-Uninstall.exe'],
    signed_catalog: catalog,
  };
  const planFile = path.join(updateRoot, 'plans', `${id}.json`);
  fs.mkdirSync(path.dirname(plan.health_confirmation_path), { recursive: true });
  try { fs.unlinkSync(plan.health_confirmation_path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  writeJsonAtomic(planFile, plan);
  return { plan, planFile };
}

module.exports = { operationId, createUpdatePlan };
