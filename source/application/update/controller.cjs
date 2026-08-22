'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateSignedCatalog } = require('./catalog.cjs');
const { fetchCatalogJson } = require('./catalog-client.cjs');
const { downloadVerifiedPayload } = require('./downloader.cjs');
const { UpdateJournal, writeJsonAtomic } = require('./journal.cjs');
const { createUpdatePlan } = require('./plan.cjs');
const { verifiedHelperCopy, runHelperPhase } = require('./helper-runner.cjs');

function publicFailure(error) {
  return { ok: false, code: String(error?.code || 'UPDATE_FAILED').slice(0, 80), message: String(error?.message || 'Update operation failed.').slice(0, 500) };
}

class UpdateController {
  constructor(options) {
    this.productId = String(options.productId || '');
    this.currentVersion = String(options.currentVersion || '');
    this.channel = String(options.channel || '');
    this.currentCommitSha = String(options.currentCommitSha || '').toLowerCase();
    this.availableContracts = Object.freeze({ ...(options.availableContracts || {}) });
    this.policy = options.policy || {};
    this.trustStore = options.trustStore || {};
    this.root = path.resolve(options.rootDirectory);
    this.updateRoot = path.join(this.root, 'Update');
    this.downloadRoot = path.join(this.updateRoot, 'downloads');
    this.catalogRoot = path.join(this.updateRoot, 'catalogs');
    this.stateFile = path.join(this.updateRoot, 'catalog-state.json');
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
  }

  acceptedState() {
    if (!fs.existsSync(this.stateFile)) return { schema_version: 1, catalog_sequence: 0, catalog_digest: null, channel: this.channel, build_id: null, updated_at: null };
    try {
      const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8').replace(/^\uFEFF/, ''));
      if (state.schema_version !== 1 || !Number.isSafeInteger(state.catalog_sequence) || state.catalog_sequence < 1 || !/^[0-9a-f]{64}$/.test(state.catalog_digest) || state.channel !== this.channel || typeof state.build_id !== 'string' || Number.isNaN(Date.parse(state.updated_at))) throw new Error('invalid state');
      return state;
    } catch {
      throw Object.assign(new Error('Saved update catalog state is invalid.'), { code: 'UPDATE_STATE_INVALID' });
    }
  }

  status() {
    let journal = null;
    try { journal = this.journal.read(); } catch (error) { return { enabled: this.policy.enabled === true, channel: this.channel, currentVersion: this.currentVersion, state: 'FAILED', code: error.code, message: error.message }; }
    return {
      enabled: this.policy.enabled === true,
      channel: this.channel,
      currentVersion: this.currentVersion,
      state: journal?.state || 'IDLE',
      targetVersion: journal?.to_version || null,
      mandatory: this.active?.validation?.mandatory === true,
      rolloutEligible: this.active?.validation?.rolloutEligible ?? null,
      error: journal?.error || null,
      rollback: journal?.rollback || null,
    };
  }

  emitStatus() {
    const status = this.status();
    this.onStatus(status);
    return status;
  }

  async check() {
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
      return { ok: true, updateAvailable: false, reason: validation.updateAvailable ? 'rollout' : 'current', status: this.emitStatus() };
    }
    const existing = this.journal.read();
    if (!existing || existing.build_id !== catalog.release.build_id || ['FAILED', 'CONFIRMED', 'ROLLED_BACK'].includes(existing.state)) {
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
    }
    this.log('signed update available', { sequence: catalog.catalog_sequence, version: catalog.release.version, buildId: catalog.release.build_id, mandatory: validation.mandatory });
    return { ok: true, updateAvailable: true, version: catalog.release.version, mandatory: validation.mandatory, releaseNotesUrl: catalog.release.release_notes_url, status: this.emitStatus() };
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
      if (this.journal.read().state === 'DOWNLOADING') this.journal.transition('VERIFYING');
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
      const active = this.active || this.loadActiveCatalog();
      const journal = this.journal.read();
      if (!journal || journal.state !== 'READY_TO_APPLY' || journal.build_id !== active.catalog.release.build_id) throw Object.assign(new Error('Verified update is not ready to apply.'), { code: 'UPDATE_NOT_READY' });
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

module.exports = { publicFailure, UpdateController };
