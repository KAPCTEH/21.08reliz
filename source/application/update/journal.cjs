'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseSemver } = require('./semver.cjs');

const STATES = Object.freeze([
  'IDLE', 'CHECKING', 'UPDATE_AVAILABLE', 'DOWNLOADING', 'VERIFYING', 'READY_TO_APPLY',
  'APPLYING', 'AWAITING_HEALTH_CONFIRMATION', 'CONFIRMED', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED',
]);
const TRANSITIONS = Object.freeze({
  IDLE: ['CHECKING'],
  CHECKING: ['IDLE', 'UPDATE_AVAILABLE', 'FAILED'],
  UPDATE_AVAILABLE: ['DOWNLOADING', 'IDLE', 'FAILED'],
  DOWNLOADING: ['VERIFYING', 'FAILED'],
  VERIFYING: ['READY_TO_APPLY', 'FAILED'],
  READY_TO_APPLY: ['APPLYING', 'IDLE', 'FAILED'],
  APPLYING: ['AWAITING_HEALTH_CONFIRMATION', 'ROLLING_BACK'],
  AWAITING_HEALTH_CONFIRMATION: ['CONFIRMED', 'ROLLING_BACK'],
  CONFIRMED: ['IDLE'],
  ROLLING_BACK: ['ROLLED_BACK', 'FAILED'],
  ROLLED_BACK: ['IDLE'],
  FAILED: ['CHECKING', 'IDLE'],
});
const SECRET_KEY = /(password|passwd|token|secret|private|authorization|cookie|credential)/i;

function journalError(message) {
  return Object.assign(new Error(message), { code: 'UPDATE_JOURNAL_INVALID' });
}

function assertNoSecrets(value, location = 'journal') {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && item != null && String(item) !== '') throw Object.assign(new Error(`Secret-like field is forbidden in ${location}: ${key}`), { code: 'UPDATE_JOURNAL_SECRET' });
    assertNoSecrets(item, `${location}.${key}`);
  }
}

function writeJsonAtomic(file, value) {
  assertNoSecrets(value);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  const data = `${JSON.stringify(value, null, 2)}\n`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, data, 'utf8'); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  try { fs.renameSync(temporary, file); }
  catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
}

function validateJournal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw journalError('Update journal must be an object.');
  const required = ['schema_version', 'operation_id', 'correlation_id', 'installation_id_hash', 'channel', 'from_version', 'to_version', 'build_id', 'commit_sha', 'catalog_sequence', 'state', 'attempt', 'created_at', 'updated_at', 'error', 'rollback'];
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(required.sort())) throw journalError('Update journal fields are invalid.');
  if (value.schema_version !== 1 || !STATES.includes(value.state)) throw journalError('Update journal schema or state is invalid.');
  for (const name of ['operation_id', 'correlation_id']) if (!/^[A-Za-z0-9._-]{16,128}$/.test(value[name])) throw journalError(`${name} is invalid.`);
  if (!/^[0-9a-f]{64}$/.test(value.installation_id_hash)) throw journalError('installation_id_hash is invalid.');
  if (!['internal', 'staging', 'stable'].includes(value.channel)) throw journalError('Update channel is invalid.');
  try { parseSemver(value.from_version); parseSemver(value.to_version); }
  catch { throw journalError('Update version is invalid.'); }
  if (typeof value.build_id !== 'string' || value.build_id.length === 0 || !/^[0-9a-f]{40}$/.test(value.commit_sha)) throw journalError('Update build identity is invalid.');
  if (!Number.isSafeInteger(value.catalog_sequence) || value.catalog_sequence < 1 || !Number.isSafeInteger(value.attempt) || value.attempt < 0) throw journalError('Update counters are invalid.');
  for (const name of ['created_at', 'updated_at']) if (typeof value[name] !== 'string' || Number.isNaN(Date.parse(value[name]))) throw journalError(`${name} is invalid.`);
  if (value.error !== null && (!value.error || typeof value.error !== 'object' || JSON.stringify(Object.keys(value.error).sort()) !== JSON.stringify(['code', 'message']) || !/^[A-Z0-9_-]{1,80}$/.test(value.error.code) || typeof value.error.message !== 'string' || value.error.message.length > 1000)) throw journalError('Update error record is invalid.');
  const rollback = value.rollback;
  if (!rollback || typeof rollback !== 'object' || JSON.stringify(Object.keys(rollback).sort()) !== JSON.stringify(['reason', 'required', 'result']) || typeof rollback.required !== 'boolean' || !['not-required', 'pending', 'succeeded', 'failed'].includes(rollback.result) || !(rollback.reason === null || (typeof rollback.reason === 'string' && rollback.reason.length <= 1000))) throw journalError('Update rollback record is invalid.');
  assertNoSecrets(value);
  return value;
}

function baseJournal(input, now) {
  return {
    schema_version: 1,
    operation_id: String(input.operation_id || crypto.randomUUID()),
    correlation_id: String(input.correlation_id || crypto.randomUUID()),
    installation_id_hash: String(input.installation_id_hash || ''),
    channel: String(input.channel || ''),
    from_version: String(input.from_version || ''),
    to_version: String(input.to_version || ''),
    build_id: String(input.build_id || ''),
    commit_sha: String(input.commit_sha || ''),
    catalog_sequence: Number(input.catalog_sequence || 0),
    state: 'IDLE',
    attempt: 0,
    created_at: now,
    updated_at: now,
    error: null,
    rollback: { required: false, result: 'not-required', reason: null },
  };
}

class UpdateJournal {
  constructor(file, options = {}) {
    this.file = path.resolve(file);
    this.now = options.now || (() => new Date());
  }

  read() {
    if (!fs.existsSync(this.file)) return null;
    let value;
    try { value = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '')); }
    catch { throw journalError('Update journal is not valid JSON.'); }
    return validateJournal(value);
  }

  create(input) {
    if (this.read()) throw Object.assign(new Error('An update journal already exists.'), { code: 'UPDATE_JOURNAL_EXISTS' });
    const now = this.now().toISOString();
    const journal = baseJournal(input, now);
    validateJournal(journal);
    writeJsonAtomic(this.file, journal);
    return journal;
  }

  begin(input) {
    const current = this.read();
    if (current) {
      if (!['IDLE', 'UPDATE_AVAILABLE', 'CONFIRMED', 'ROLLED_BACK', 'FAILED'].includes(current.state)) {
        throw Object.assign(new Error(`Cannot replace active update operation in state ${current.state}.`), { code: 'UPDATE_OPERATION_ACTIVE' });
      }
      const historyDirectory = path.join(path.dirname(this.file), 'history');
      const archive = path.join(historyDirectory, `${current.updated_at.replace(/[:.]/g, '-')}-${current.operation_id}.json`);
      writeJsonAtomic(archive, current);
      fs.unlinkSync(this.file);
    }
    return this.create(input);
  }

  transition(nextState, patch = {}) {
    const current = this.read();
    if (!current) throw Object.assign(new Error('Update journal does not exist.'), { code: 'UPDATE_JOURNAL_MISSING' });
    if (!STATES.includes(nextState) || !TRANSITIONS[current.state]?.includes(nextState)) {
      throw Object.assign(new Error(`Invalid update transition: ${current.state} -> ${nextState}`), { code: 'UPDATE_TRANSITION_INVALID' });
    }
    const next = {
      ...current,
      ...patch,
      schema_version: 1,
      operation_id: current.operation_id,
      correlation_id: current.correlation_id,
      state: nextState,
      attempt: current.attempt + (nextState === 'CHECKING' ? 1 : 0),
      updated_at: this.now().toISOString(),
    };
    validateJournal(next);
    writeJsonAtomic(this.file, next);
    return next;
  }

  recoveryAction() {
    const journal = this.read();
    if (!journal) return { action: 'none', state: 'IDLE' };
    if (['APPLYING', 'AWAITING_HEALTH_CONFIRMATION', 'ROLLING_BACK'].includes(journal.state)) return { action: 'rollback', state: journal.state };
    if (['DOWNLOADING', 'VERIFYING'].includes(journal.state)) return { action: 'resume-download', state: journal.state };
    if (journal.state === 'READY_TO_APPLY') return { action: 'ready', state: journal.state };
    return { action: 'none', state: journal.state };
  }
}

module.exports = { STATES, TRANSITIONS, assertNoSecrets, validateJournal, writeJsonAtomic, UpdateJournal };
