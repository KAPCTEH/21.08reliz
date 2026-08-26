'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateSignedCatalog } = require('./catalog.cjs');
const { fetchCatalogJson } = require('./catalog-client.cjs');
const { downloadVerifiedPayload } = require('./downloader.cjs');
const { UpdateJournal, validateJournal, writeJsonAtomic } = require('./journal.cjs');
const { createUpdatePlan } = require('./plan.cjs');
const { verifiedHelperCopy, runHelperPhase } = require('./helper-runner.cjs');

function publicFailure(error) {
  return { ok: false, code: String(error?.code || 'UPDATE_FAILED').slice(0, 80), message: String(error?.message || 'Update operation failed.').slice(0, 500) };
}

const ACCEPTED_STATE_KEYS = Object.freeze(['build_id', 'catalog_digest', 'catalog_sequence', 'channel', 'schema_version', 'updated_at']);
const JOURNAL_PROOF_STATES = new Set([
  'CHECKING', 'UPDATE_AVAILABLE', 'DOWNLOADING', 'VERIFYING', 'READY_TO_APPLY',
  'APPLYING', 'AWAITING_HEALTH_CONFIRMATION', 'ROLLING_BACK',
]);
const JOURNAL_PRE_APPLY_STATES = new Set(['CHECKING', 'UPDATE_AVAILABLE', 'DOWNLOADING', 'VERIFYING', 'READY_TO_APPLY']);
const JOURNAL_APPLY_STATES = new Set(['APPLYING', 'AWAITING_HEALTH_CONFIRMATION', 'ROLLING_BACK']);

function invalidAcceptedState() {
  return Object.assign(new Error('Saved update catalog state is invalid.'), { code: 'UPDATE_STATE_INVALID' });
}

function parseAcceptedState(value, expectedChannel = null) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid state');
    if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(ACCEPTED_STATE_KEYS)) throw new Error('invalid state keys');
    if (value.schema_version !== 1 || !Number.isSafeInteger(value.catalog_sequence) || value.catalog_sequence < 1) throw new Error('invalid sequence');
    if (!/^[0-9a-f]{64}$/.test(String(value.catalog_digest || ''))) throw new Error('invalid digest');
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(String(value.channel || ''))) throw new Error('invalid channel');
    if (expectedChannel !== null && value.channel !== expectedChannel) throw new Error('channel mismatch');
    if (typeof value.build_id !== 'string' || !/^[A-Za-z0-9._-]{1,160}$/.test(value.build_id)) throw new Error('invalid build');
    if (typeof value.updated_at !== 'string' || Number.isNaN(Date.parse(value.updated_at))) throw new Error('invalid timestamp');
    return value;
  } catch {
    throw invalidAcceptedState();
  }
}

function validateAcceptedCatalogProof(catalog, options) {
  const versions = catalog?.directive?.mode === 'rollback'
    ? catalog?.directive?.rollback_from_versions
    : [catalog?.release?.version];
  if (!Array.isArray(versions) || versions.length === 0) throw invalidAcceptedState();
  let lastError = null;
  for (const currentVersion of versions) {
    try {
      return validateSignedCatalog(catalog, { ...options, currentVersion: String(currentVersion || '') });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || invalidAcceptedState();
}

function resolveUpdateChannelBinding(options) {
  const fallback = String(options.channel || '');
  const stateFile = path.join(path.resolve(options.rootDirectory), 'Update', 'catalog-state.json');
  try {
    const journal = options.journal == null ? null : validateJournal(options.journal);
    if (!fs.existsSync(stateFile)) {
      if (journal) throw invalidAcceptedState();
      return { channel: fallback, error: null };
    }
    const state = parseAcceptedState(JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, '')));
    const endpoint = options.policy?.catalog_endpoints?.[state.channel];
    if (typeof endpoint !== 'string' || endpoint.trim() === '') throw invalidAcceptedState();
    const catalogFile = path.join(path.dirname(stateFile), 'catalogs', `${state.catalog_digest}.json`);
    if (!fs.existsSync(catalogFile)) throw invalidAcceptedState();
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8').replace(/^\uFEFF/, ''));
    const validation = validateAcceptedCatalogProof(catalog, {
      now: new Date(state.updated_at),
      productId: options.productId,
      allowedChannels: [state.channel],
      allowedPayloadHosts: options.policy?.allowed_payload_hosts,
      allowedReleaseNotesHosts: options.policy?.allowed_release_notes_hosts,
      maximumPayloadBytes: options.policy?.max_payload_bytes,
      trustStore: options.trustStore,
      availableContracts: options.availableContracts,
      previousSequence: state.catalog_sequence,
      previousDigest: state.catalog_digest,
      installationId: options.installationId,
    });
    if (validation.digest !== state.catalog_digest
      || catalog.catalog_sequence !== state.catalog_sequence
      || catalog.channel !== state.channel
      || catalog.release.build_id !== state.build_id) throw invalidAcceptedState();
    if (journal && JOURNAL_PROOF_STATES.has(journal.state) && (
      journal.channel !== state.channel
      || journal.build_id !== state.build_id
      || journal.catalog_sequence !== state.catalog_sequence
      || journal.to_version !== catalog.release.version
      || journal.commit_sha !== catalog.release.commit_sha
    )) throw invalidAcceptedState();
    return { channel: state.channel, error: null };
  } catch (cause) {
    const error = invalidAcceptedState();
    error.cause = cause;
    return { channel: fallback, error };
  }
}

class UpdateController {
  constructor(options) {
    this.productId = String(options.productId || '');
    this.currentVersion = String(options.currentVersion || '');
    this.defaultChannel = String(options.channel || '');
    this.currentCommitSha = String(options.currentCommitSha || '').toLowerCase();
    this.availableContracts = Object.freeze({ ...(options.availableContracts || {}) });
    this.policy = options.policy || {};
    this.trustStore = options.trustStore || {};
    this.root = path.resolve(options.rootDirectory);
    this.updateRoot = path.join(this.root, 'Update');
    this.downloadRoot = path.join(this.updateRoot, 'downloads');
    this.catalogRoot = path.join(this.updateRoot, 'catalogs');
    this.stateFile = path.join(this.updateRoot, 'catalog-state.json');
    this.scheduleFile = path.join(this.updateRoot, 'schedule.json');
    this.journal = new UpdateJournal(path.join(this.updateRoot, 'journal.json'), { now: options.now });
    this.installationId = String(options.installationId || '');
    this.installRoot = path.resolve(String(options.installRoot || '.'));
    this.installedHelper = path.resolve(String(options.installedHelper || path.join(this.installRoot, 'JustFun-UpdateHelper.exe')));
    this.helperIdentity = options.helperIdentity || null;
    this.now = options.now || (() => new Date());
    this.fetchCatalog = options.fetchCatalog || fetchCatalogJson;
    this.downloadPayload = options.downloadPayload || downloadVerifiedPayload;
    this.prepareUpdate = options.prepareUpdate || ((active, journal) => this.runPrepareHelper(active, journal));
    this.applyUpdate = options.applyUpdate || ((active, journal) => this.runApplyHelper(active, journal));
    this.onApplyScheduled = typeof options.onApplyScheduled === 'function' ? options.onApplyScheduled : () => {};
    this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {};
    this.log = typeof options.log === 'function' ? options.log : () => {};
    this.active = null;
    let binding;
    try {
      binding = resolveUpdateChannelBinding({
        channel: this.defaultChannel,
        productId: this.productId,
        availableContracts: this.availableContracts,
        policy: this.policy,
        trustStore: this.trustStore,
        rootDirectory: this.root,
        installationId: this.installationId,
        journal: this.journal.read(),
      });
    } catch (error) {
      binding = { channel: this.defaultChannel, error };
    }
    this.channel = binding.channel;
    this.channelBindingError = binding.error;
  }

  assertChannelBinding() {
    if (this.channelBindingError) throw this.channelBindingError;
  }

  acceptedState() {
    this.assertChannelBinding();
    if (!fs.existsSync(this.stateFile)) return { schema_version: 1, catalog_sequence: 0, catalog_digest: null, channel: this.channel, build_id: null, updated_at: null };
    try {
      return parseAcceptedState(JSON.parse(fs.readFileSync(this.stateFile, 'utf8').replace(/^\uFEFF/, '')), this.channel);
    } catch {
      throw invalidAcceptedState();
    }
  }

  status() {
    let journal = null;
    let accepted = null;
    try { journal = this.journal.read(); } catch (error) { return { enabled: this.policy.enabled === true, channel: this.channel, currentVersion: this.currentVersion, state: 'FAILED', code: error.code, message: error.message }; }
    if (this.channelBindingError) return {
      enabled: this.policy.enabled === true,
      channel: this.channel,
      currentVersion: this.currentVersion,
      state: 'FAILED',
      targetVersion: journal && journal.state !== 'IDLE' ? journal.to_version : null,
      diagnosticId: this.diagnosticId(journal),
      error: publicFailure(this.channelBindingError),
      rollback: journal?.rollback || null,
    };
    try { accepted = this.acceptedState(); } catch {}
    if (!this.active && accepted?.catalog_sequence > 0) { try { this.loadActiveCatalog(); } catch {} }
    const schedule = this.readSchedule(journal);
    const lastOperationRecord = this.lastCompletedOperation(journal);
    const lastOperation = lastOperationRecord ? {
      state: lastOperationRecord.state,
      toVersion: lastOperationRecord.toVersion,
      updatedAt: lastOperationRecord.updatedAt,
      rollback: lastOperationRecord.rollback,
    } : null;
    return {
      enabled: this.policy.enabled === true,
      channel: this.channel,
      currentVersion: this.currentVersion,
      state: journal?.state || 'IDLE',
      targetVersion: journal && journal.state !== 'IDLE' ? journal.to_version : null,
      lastCheckedAt: accepted?.updated_at || null,
      mandatory: this.active?.validation?.mandatory === true,
      rolloutEligible: this.active?.validation?.rolloutEligible ?? null,
      directiveMode: this.active?.validation?.directive?.mode || null,
      directiveMessage: this.active?.validation?.directive?.message || null,
      rollbackRecommended: this.active?.validation?.rollbackRecommended === true,
      releaseNotesUrl: this.active?.catalog?.release?.release_notes_url || null,
      payloadBytes: this.active?.catalog?.release?.payload?.bytes || null,
      releaseSummary: this.active?.catalog?.release?.summary || null,
      installTiming: schedule?.mode || null,
      remindAfter: schedule?.remind_after || null,
      lastOperation,
      diagnosticId: this.diagnosticId(journal || lastOperationRecord),
      error: journal?.error || null,
      rollback: journal?.rollback || null,
    };
  }

  diagnosticId(operation) {
    const source = String(operation?.correlation_id || operation?.operation_id || '');
    return source ? `JF-UPD-${crypto.createHash('sha256').update(source, 'utf8').digest('hex').slice(0, 12).toUpperCase()}` : null;
  }

  lastCompletedOperation(current = null) {
    const completed = new Set(['CONFIRMED', 'ROLLED_BACK', 'FAILED']);
    if (current && completed.has(current.state)) return {
      state: current.state, toVersion: current.to_version, updatedAt: current.updated_at,
      rollback: current.rollback, operation_id: current.operation_id, correlation_id: current.correlation_id,
    };
    const directory = path.join(this.updateRoot, 'history');
    if (!fs.existsSync(directory)) return null;
    const files = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort().reverse();
    for (const name of files) {
      try {
        const value = validateJournal(JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8').replace(/^\uFEFF/, '')));
        if (completed.has(value.state)) return {
          state: value.state, toVersion: value.to_version, updatedAt: value.updated_at,
          rollback: value.rollback, operation_id: value.operation_id, correlation_id: value.correlation_id,
        };
      } catch {}
    }
    return null;
  }

  readSchedule(journal = this.journal.read()) {
    if (!fs.existsSync(this.scheduleFile)) return null;
    try {
      const value = JSON.parse(fs.readFileSync(this.scheduleFile, 'utf8').replace(/^\uFEFF/, ''));
      const expected = ['schema_version', 'operation_id', 'build_id', 'mode', 'scheduled_at', 'remind_after'].sort();
      if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected) || value.schema_version !== 1 || !/^[A-Za-z0-9._-]{16,128}$/.test(value.operation_id) || typeof value.build_id !== 'string' || !['after_close', 'remind_later'].includes(value.mode) || Number.isNaN(Date.parse(value.scheduled_at)) || !(value.remind_after === null || !Number.isNaN(Date.parse(value.remind_after)))) throw new Error('invalid schedule');
      if (!journal || journal.operation_id !== value.operation_id || journal.build_id !== value.build_id) return null;
      return value;
    } catch {
      return null;
    }
  }

  clearSchedule() {
    try { fs.unlinkSync(this.scheduleFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  defer(mode) {
    try {
      this.assertChannelBinding();
      const journal = this.journal.read();
      const validState = mode === 'after_close' ? journal?.state === 'READY_TO_APPLY' : ['UPDATE_AVAILABLE', 'READY_TO_APPLY'].includes(journal?.state);
      if (!validState || !['after_close', 'remind_later'].includes(mode)) throw Object.assign(new Error('The update cannot be deferred in its current state.'), { code: 'UPDATE_DEFER_NOT_AVAILABLE' });
      const now = this.now();
      const schedule = {
        schema_version: 1,
        operation_id: journal.operation_id,
        build_id: journal.build_id,
        mode,
        scheduled_at: now.toISOString(),
        remind_after: mode === 'remind_later' ? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() : null,
      };
      writeJsonAtomic(this.scheduleFile, schedule);
      this.log('update timing selected', { mode, operationId: journal.operation_id });
      return { ok: true, mode, remindAfter: schedule.remind_after, status: this.emitStatus() };
    } catch (error) {
      return { ...publicFailure(error), status: this.emitStatus() };
    }
  }

  shouldApplyOnClose() {
    if (this.channelBindingError) return false;
    const journal = this.journal.read();
    const schedule = this.readSchedule(journal);
    return Boolean(journal?.state === 'READY_TO_APPLY' && schedule?.mode === 'after_close');
  }

  cancelPendingUpdate(validation) {
    const journal = this.journal.read();
    if (!journal) return null;
    const withdrawn = validation.directive.withdrawnBuildIds.includes(journal.build_id);
    const sameBuildUnavailable = journal.build_id === validation.catalog.release.build_id
      && (!validation.updateAvailable || !validation.rolloutEligible);
    const superseded = journal.catalog_sequence < validation.catalog.catalog_sequence
      && journal.build_id !== validation.catalog.release.build_id;
    if (!withdrawn && !sameBuildUnavailable && !superseded) return null;
    if (['UPDATE_AVAILABLE', 'READY_TO_APPLY'].includes(journal.state)) {
      this.journal.transition('IDLE');
    } else if (['DOWNLOADING', 'VERIFYING'].includes(journal.state)) {
      this.journal.transition('FAILED', { error: { code: 'UPDATE_WITHDRAWN', message: 'The downloaded update was withdrawn by a newer signed catalog.' } });
    } else {
      return null;
    }
    this.clearSchedule();
    this.log('pending update cancelled by signed catalog', {
      buildId: journal.build_id,
      sequence: validation.catalog.catalog_sequence,
      directive: validation.directive.mode,
    });
    return withdrawn ? 'withdrawn' : (superseded ? 'superseded' : 'unavailable');
  }

  assertCatalogCheckAllowed() {
    const journal = this.journal.read();
    if (journal && JOURNAL_APPLY_STATES.has(journal.state)) {
      throw Object.assign(new Error('An update is being applied or recovered. A new catalog check is temporarily blocked.'), { code: 'UPDATE_OPERATION_ACTIVE' });
    }
  }

  rotatePendingUpdateProof(validation) {
    const journal = this.journal.read();
    if (!journal || !JOURNAL_PRE_APPLY_STATES.has(journal.state)) return false;
    const catalog = validation.catalog;
    const sameProof = journal.channel === catalog.channel
      && journal.build_id === catalog.release.build_id
      && journal.catalog_sequence === catalog.catalog_sequence
      && journal.to_version === catalog.release.version
      && journal.commit_sha === catalog.release.commit_sha;
    if (sameProof) return false;
    if (['UPDATE_AVAILABLE', 'READY_TO_APPLY'].includes(journal.state)) {
      this.journal.transition('IDLE');
    } else {
      this.journal.transition('FAILED', {
        error: { code: 'UPDATE_PROOF_REPLACED', message: 'A newer signed catalog proof replaced the pending update operation.' },
      });
    }
    this.clearSchedule();
    this.log('pending update proof rotated', {
      buildId: journal.build_id,
      previousSequence: journal.catalog_sequence,
      acceptedSequence: catalog.catalog_sequence,
    });
    return true;
  }

  emitStatus() {
    const status = this.status();
    this.onStatus(status);
    return status;
  }

  async check() {
    this.assertChannelBinding();
    this.assertCatalogCheckAllowed();
    if (this.policy.enabled !== true) return { ok: false, code: 'UPDATE_DISABLED', message: 'Automatic updates are not configured for this development build.', status: this.emitStatus() };
    const endpoint = this.policy.catalog_endpoints?.[this.channel];
    if (!endpoint) return { ok: false, code: 'UPDATE_ENDPOINT_MISSING', message: 'Update catalog endpoint is not configured.', status: this.emitStatus() };
    const catalog = await this.fetchCatalog({
      url: endpoint,
      allowedHosts: this.policy.allowed_catalog_hosts,
      maximumBytes: this.policy.max_catalog_bytes,
      timeoutMs: this.policy.download_timeout_seconds * 1000,
      clientVersion: this.currentVersion,
    });
    this.assertCatalogCheckAllowed();
    const previous = this.acceptedState();
    const validation = validateSignedCatalog(catalog, {
      now: this.now(),
      productId: this.productId,
      allowedChannels: [this.channel],
      allowedPayloadHosts: this.policy.allowed_payload_hosts,
      allowedReleaseNotesHosts: this.policy.allowed_release_notes_hosts,
      maximumPayloadBytes: this.policy.max_payload_bytes,
      trustStore: this.trustStore,
      availableContracts: this.availableContracts,
      currentVersion: this.currentVersion,
      previousSequence: previous.catalog_sequence,
      previousDigest: previous.catalog_digest,
      installationId: this.installationId,
    });
    fs.mkdirSync(this.catalogRoot, { recursive: true });
    const catalogFile = path.join(this.catalogRoot, `${validation.digest}.json`);
    writeJsonAtomic(catalogFile, catalog);
    const cancellationReason = this.cancelPendingUpdate(validation);
    this.rotatePendingUpdateProof(validation);
    writeJsonAtomic(this.stateFile, {
      schema_version: 1,
      catalog_sequence: catalog.catalog_sequence,
      catalog_digest: validation.digest,
      channel: catalog.channel,
      build_id: catalog.release.build_id,
      updated_at: this.now().toISOString(),
    });
    this.active = { catalog, validation, catalogFile };
    if (!validation.updateAvailable || !validation.rolloutEligible) {
      this.log('update catalog checked', { sequence: catalog.catalog_sequence, updateAvailable: validation.updateAvailable, rolloutEligible: validation.rolloutEligible });
      const reason = validation.directive.mode === 'halt' ? 'halt' : (cancellationReason || (validation.updateAvailable ? 'rollout' : 'current'));
      return { ok: true, updateAvailable: false, reason, status: this.emitStatus() };
    }
    const existing = this.journal.read();
    const sameOperationProof = existing
      && existing.channel === catalog.channel
      && existing.build_id === catalog.release.build_id
      && existing.catalog_sequence === catalog.catalog_sequence
      && existing.to_version === catalog.release.version
      && existing.commit_sha === catalog.release.commit_sha;
    if (!sameOperationProof || ['FAILED', 'CONFIRMED', 'ROLLED_BACK'].includes(existing.state)) {
      this.clearSchedule();
      this.journal.begin({
        installation_id_hash: crypto.createHash('sha256').update(this.installationId, 'utf8').digest('hex'),
        channel: this.channel,
        from_version: this.currentVersion,
        to_version: catalog.release.version,
        build_id: catalog.release.build_id,
        commit_sha: catalog.release.commit_sha,
        catalog_sequence: catalog.catalog_sequence,
      });
      this.journal.transition('CHECKING');
      this.journal.transition('UPDATE_AVAILABLE');
    } else if (existing.state === 'IDLE') {
      this.journal.transition('CHECKING');
      this.journal.transition('UPDATE_AVAILABLE');
    } else if (existing.state === 'CHECKING') {
      this.journal.transition('UPDATE_AVAILABLE');
    }
    this.log('signed update available', { sequence: catalog.catalog_sequence, version: catalog.release.version, buildId: catalog.release.build_id, mandatory: validation.mandatory });
    return { ok: true, updateAvailable: true, version: catalog.release.version, mandatory: validation.mandatory, rollbackRecommended: validation.rollbackRecommended, releaseNotesUrl: catalog.release.release_notes_url, payloadBytes: catalog.release.payload.bytes, status: this.emitStatus() };
  }

  loadActiveCatalog() {
    const state = this.acceptedState();
    const catalogFile = path.join(this.catalogRoot, `${state.catalog_digest}.json`);
    if (!fs.existsSync(catalogFile)) throw Object.assign(new Error('Verified update catalog is missing.'), { code: 'UPDATE_CATALOG_MISSING' });
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8').replace(/^\uFEFF/, ''));
    const validation = validateSignedCatalog(catalog, {
      now: this.now(), productId: this.productId, allowedChannels: [this.channel],
      allowedPayloadHosts: this.policy.allowed_payload_hosts, allowedReleaseNotesHosts: this.policy.allowed_release_notes_hosts,
      maximumPayloadBytes: this.policy.max_payload_bytes, trustStore: this.trustStore,
      availableContracts: this.availableContracts, currentVersion: this.currentVersion,
      previousSequence: state.catalog_sequence, previousDigest: state.catalog_digest, installationId: this.installationId,
    });
    this.active = { catalog, validation, catalogFile };
    return this.active;
  }

  async download() {
    try {
      this.assertChannelBinding();
      const active = this.active || this.loadActiveCatalog();
      const journal = this.journal.read();
      if (!journal || journal.build_id !== active.catalog.release.build_id || !['UPDATE_AVAILABLE', 'DOWNLOADING', 'VERIFYING'].includes(journal.state)) throw Object.assign(new Error('No verified update is ready to download.'), { code: 'UPDATE_NOT_AVAILABLE' });
      if (journal.state === 'UPDATE_AVAILABLE') this.journal.transition('DOWNLOADING');
      const payload = active.catalog.release.payload;
      const result = await this.downloadPayload({
        url: payload.url,
        allowedHosts: this.policy.allowed_payload_hosts,
        destination: path.join(this.downloadRoot, payload.file_name),
        expectedBytes: payload.bytes,
        expectedSha256: payload.sha256,
        maximumPayloadBytes: this.policy.max_payload_bytes,
        timeoutMs: this.policy.download_timeout_seconds * 1000,
        maxAttempts: this.policy.max_download_attempts,
        clientVersion: this.currentVersion,
        onProgress: progress => this.onStatus({ ...this.status(), progress }),
      });
      const afterDownload = this.journal.read();
      if (!afterDownload || afterDownload.build_id !== active.catalog.release.build_id || afterDownload.state !== 'DOWNLOADING') throw Object.assign(new Error('The update was withdrawn while it was downloading.'), { code: 'UPDATE_WITHDRAWN' });
      this.journal.transition('VERIFYING');
      await this.prepareUpdate(active, this.journal.read());
      this.journal.transition('READY_TO_APPLY');
      this.log('update payload verified', { version: active.catalog.release.version, bytes: result.bytes, sha256: result.sha256 });
      return { ok: true, version: active.catalog.release.version, bytes: result.bytes, sha256: result.sha256, status: this.emitStatus() };
    } catch (error) {
      const current = (() => { try { return this.journal.read(); } catch { return null; } })();
      if (current && ['DOWNLOADING', 'VERIFYING'].includes(current.state)) {
        try { this.journal.transition('FAILED', { error: { code: String(error?.code || 'UPDATE_DOWNLOAD_FAILED').replace(/[^A-Z0-9_-]/g, '_').slice(0, 80), message: String(error?.message || 'Update download failed.').slice(0, 1000) } }); } catch {}
      }
      this.log('update payload failed', { code: String(error?.code || 'UPDATE_DOWNLOAD_FAILED'), error: String(error?.message || '').slice(0, 500) });
      return { ...publicFailure(error), status: this.emitStatus() };
    }
  }

  plan(active, journal) {
    return createUpdatePlan({
      operationId: journal.operation_id,
      fromVersion: this.currentVersion,
      installRoot: this.installRoot,
      updateRoot: this.updateRoot,
      catalog: active.catalog,
      sourcePid: process.pid,
      healthTimeoutSeconds: this.policy.health_confirmation_timeout_seconds,
      now: this.now(),
    });
  }

  helperPath() {
    return verifiedHelperCopy({ installedHelper: this.installedHelper, identity: this.helperIdentity, updateRoot: this.updateRoot });
  }

  async runPrepareHelper(active, journal) {
    this.plan(active, journal);
    return runHelperPhase({ helperPath: this.helperPath(), operationId: journal.operation_id, phase: 'prepare' });
  }

  async runApplyHelper(active, journal) {
    this.plan(active, journal);
    return runHelperPhase({ helperPath: this.helperPath(), operationId: journal.operation_id, phase: 'apply' });
  }

  async apply() {
    try {
      this.assertChannelBinding();
      const active = this.active || this.loadActiveCatalog();
      const journal = this.journal.read();
      if (!journal || journal.state !== 'READY_TO_APPLY' || journal.build_id !== active.catalog.release.build_id) throw Object.assign(new Error('Verified update is not ready to apply.'), { code: 'UPDATE_NOT_READY' });
      this.clearSchedule();
      this.journal.transition('APPLYING');
      try { await this.applyUpdate(active, this.journal.read()); }
      catch (error) {
        this.journal.transition('ROLLING_BACK', { rollback: { required: false, result: 'pending', reason: 'helper launch failed' } });
        this.journal.transition('ROLLED_BACK', { error: { code: String(error?.code || 'UPDATE_HELPER_START').replace(/[^A-Z0-9_-]/g, '_').slice(0, 80), message: String(error?.message || 'Update Helper could not start.').slice(0, 1000) }, rollback: { required: false, result: 'succeeded', reason: 'no files were changed' } });
        throw error;
      }
      this.log('update apply scheduled', { version: active.catalog.release.version, operationId: journal.operation_id });
      this.onApplyScheduled({ operationId: journal.operation_id, version: active.catalog.release.version });
      return { ok: true, scheduled: true, operationId: journal.operation_id, status: this.emitStatus() };
    } catch (error) {
      return { ...publicFailure(error), status: this.emitStatus() };
    }
  }

  helperState() {
    const file = path.join(this.updateRoot, 'helper-state.json');
    if (!fs.existsSync(file)) return null;
    try {
      const state = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      const expected = ['schema_version', 'operation_id', 'phase', 'updated_at', 'message'].sort();
      if (JSON.stringify(Object.keys(state).sort()) !== JSON.stringify(expected) || state.schema_version !== 1 || !/^[A-Za-z0-9._-]{16,128}$/.test(state.operation_id) || !['PREPARING', 'PREPARED', 'APPLYING', 'CURRENT_MOVED', 'AWAITING_HEALTH_CONFIRMATION', 'CONFIRMED', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED'].includes(state.phase) || Number.isNaN(Date.parse(state.updated_at)) || !(state.message === null || typeof state.message === 'string')) throw new Error('invalid helper state');
      return state;
    } catch {
      throw Object.assign(new Error('Update Helper state is invalid.'), { code: 'UPDATE_HELPER_STATE_INVALID' });
    }
  }

  reconcileHelperState() {
    const helper = this.helperState();
    const journal = this.journal.read();
    if (!helper || !journal || helper.operation_id !== journal.operation_id) return this.status();
    if (['APPLYING', 'CURRENT_MOVED', 'AWAITING_HEALTH_CONFIRMATION'].includes(helper.phase) && journal.state === 'APPLYING') this.journal.transition('AWAITING_HEALTH_CONFIRMATION');
    if (helper.phase === 'CONFIRMED') {
      if (this.journal.read().state === 'APPLYING') this.journal.transition('AWAITING_HEALTH_CONFIRMATION');
      if (this.journal.read().state === 'AWAITING_HEALTH_CONFIRMATION') this.journal.transition('CONFIRMED', { rollback: { required: false, result: 'not-required', reason: null } });
    }
    if (['ROLLING_BACK', 'ROLLED_BACK', 'FAILED'].includes(helper.phase)) {
      const state = this.journal.read().state;
      if (['APPLYING', 'AWAITING_HEALTH_CONFIRMATION'].includes(state)) this.journal.transition('ROLLING_BACK', { rollback: { required: true, result: 'pending', reason: helper.message || 'Update health confirmation failed.' } });
      if (helper.phase === 'ROLLED_BACK' && this.journal.read().state === 'ROLLING_BACK') this.journal.transition('ROLLED_BACK', { rollback: { required: true, result: 'succeeded', reason: helper.message || 'Previous version restored.' } });
      if (helper.phase === 'FAILED' && this.journal.read().state === 'ROLLING_BACK') this.journal.transition('FAILED', { error: { code: 'UPDATE_ROLLBACK_FAILED', message: String(helper.message || 'Automatic rollback failed.').slice(0, 1000) }, rollback: { required: true, result: 'failed', reason: String(helper.message || 'Automatic rollback failed.').slice(0, 1000) } });
    }
    return this.emitStatus();
  }

  confirmHealth(operationId) {
    this.reconcileHelperState();
    this.assertChannelBinding();
    const journal = this.journal.read();
    if (!journal || journal.operation_id !== String(operationId || '') || journal.to_version !== this.currentVersion || !['APPLYING', 'AWAITING_HEALTH_CONFIRMATION'].includes(journal.state)) throw Object.assign(new Error('Update health confirmation does not match this application build.'), { code: 'UPDATE_HEALTH_MISMATCH' });
    if (journal.state === 'APPLYING') this.journal.transition('AWAITING_HEALTH_CONFIRMATION');
    const healthFile = path.join(this.updateRoot, 'health', `${journal.operation_id}.json`);
    writeJsonAtomic(healthFile, { schema_version: 1, operation_id: journal.operation_id, version: this.currentVersion, confirmed_at: this.now().toISOString() });
    this.log('update health confirmed by application', { operationId: journal.operation_id, version: this.currentVersion });
    return { ok: true, operationId: journal.operation_id };
  }

  async recover() {
    try {
      const journal = this.journal.read();
      if (!journal || !['APPLYING', 'AWAITING_HEALTH_CONFIRMATION', 'ROLLING_BACK'].includes(journal.state)) throw Object.assign(new Error('No interrupted update requires recovery.'), { code: 'UPDATE_RECOVERY_NOT_REQUIRED' });
      const planFile = path.join(this.updateRoot, 'plans', `${journal.operation_id}.json`);
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8').replace(/^\uFEFF/, ''));
      plan.source_pid = process.pid;
      writeJsonAtomic(planFile, plan);
      const result = await runHelperPhase({ helperPath: this.helperPath(), operationId: journal.operation_id, phase: 'recover' });
      this.log('update recovery scheduled', { operationId: journal.operation_id });
      this.onApplyScheduled({ operationId: journal.operation_id, recovery: true });
      return { ok: true, scheduled: true, ...result };
    } catch (error) {
      return publicFailure(error);
    }
  }

  startupRecovery() {
    return this.journal.recoveryAction();
  }
}

module.exports = { publicFailure, parseAcceptedState, resolveUpdateChannelBinding, UpdateController };
