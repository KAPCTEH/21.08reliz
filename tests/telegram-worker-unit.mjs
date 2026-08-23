import assert from 'node:assert/strict';
import { dispatch, parseCommand, telegramChatMeta } from '../source/application/integrations/telegram-cloudflare-native/worker/index.js';
import { claimTelegramUpdate } from '../source/application/integrations/telegram-cloudflare-native/worker/db.js';
import { canTransition, nextKeyboard, parseStatusCallback, STATUS_LABELS } from '../source/application/integrations/telegram-cloudflare-native/worker/status.js';

const clientKey = 'C'.repeat(64);
const rows = [{
  warehouse_id: 'live--warehouse_01',
  entity_type: 'driver',
  entity_id: 'driver_01',
  chat_id: 'SECRET_CHAT_ID',
  chat_type: 'private',
  title: 'Иван Петров',
  username: 'driver_one',
  user_id: '1001',
  updated_at: '2026-07-28T10:00:00.000Z'
}];

const db = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() { return null; },
          async all() {
            assert.match(sql, /FROM chat_bindings_v2/);
            assert.deepEqual(values.slice(0, 3), ['inst-warehouse-01', 'company_01', 'live--warehouse_01']);
            return { results: rows };
          }
        };
      }
    };
  }
};
const env = {
  DB: db,
  BOT_TOKEN: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef',
  WEBHOOK_SECRET: 'W'.repeat(48),
  CLIENT_API_KEY: clientKey,
  BOT_USERNAME: 'justfun_test_bot',
  INSTALLATION_ID: 'inst-warehouse-01',
  COMPANY_ID: 'company_01',
  WAREHOUSE_ID: 'live--warehouse_01'
};

const healthResponse = await dispatch(new Request('https://worker.test/health'), env);
assert.equal(healthResponse.status, 200);
assert.equal((await healthResponse.json()).telegram_deprovision_contract, 1);

await assert.rejects(
  dispatch(new Request('https://worker.test/v1/bindings?warehouse_id=live--warehouse_01'), env),
  error => error?.status === 401 && error?.code === 'unauthorized'
);

const response = await dispatch(new Request(
  'https://worker.test/v1/bindings?warehouse_id=live--warehouse_01',
  { headers: { Authorization: `Bearer ${clientKey}` } }
), env);
assert.equal(response.status, 200);
const payload = await response.json();
assert.equal(payload.ok, true);
assert.equal(payload.bindings.length, 1);
assert.equal(payload.bindings[0].entity_id, 'driver_01');
assert.equal(Object.hasOwn(payload.bindings[0], 'chat_id'), false);
assert.equal(JSON.stringify(payload).includes('SECRET_CHAT_ID'), false);

await assert.rejects(
  dispatch(new Request(
    'https://worker.test/v1/bindings?warehouse_id=live--warehouse_other',
    { headers: { Authorization: `Bearer ${clientKey}` } }
  ), env),
  error => error?.status === 403 && error?.code === 'warehouse_scope_forbidden'
);

function createUpdateDb() {
  const updates = new Map();
  return {
    prepare(sql) {
      const statement = String(sql);
      return {
        bind(...values) {
          return {
            async run() {
              if (statement.includes('INSERT OR IGNORE INTO telegram_updates_v2')) {
                const key = `${values[0]}:${values[3]}`;
                if (updates.has(key)) return {meta: {changes: 0}};
                updates.set(key, {installation_id: values[0], update_id: values[3], status: 'processing', claim_token: values[4], received_at: values[5]});
                return {meta: {changes: 1}};
              }
              return {meta: {changes: 0}};
            },
            async first() {
              return updates.get(`${values[0]}:${values[1]}`) || null;
            }
          };
        }
      };
    }
  };
}

const updateDb = createUpdateDb();
const scopeOne = {installationId: 'inst-one', companyId: 'company_01', warehouseId: 'live--warehouse_01'};
const scopeTwo = {installationId: 'inst-two', companyId: 'company_01', warehouseId: 'live--warehouse_02'};
assert.equal((await claimTelegramUpdate(updateDb, scopeOne, 500)).state, 'claimed');
assert.equal((await claimTelegramUpdate(updateDb, scopeTwo, 500)).state, 'claimed');

assert.deepEqual(parseCommand('/start abc123'), { command: 'start', argument: 'abc123' });
assert.deepEqual(parseCommand('/подключить_склад CODE-1'), { command: 'подключить_склад', argument: 'CODE-1' });
assert.equal(parseCommand('обычный текст'), null);
assert.deepEqual(telegramChatMeta({
  chat: { id: 77, type: 'private' },
  from: { id: 1001, username: 'driver_one', first_name: 'Иван' }
}), {
  chatId: '77',
  chatType: 'private',
  title: 'Иван',
  username: 'driver_one',
  userId: '1001'
});

assert.equal(canTransition('driver', 'sent', 'accepted'), true);
assert.equal(canTransition('driver', 'sent', 'completed'), false);
assert.equal(canTransition('warehouse', 'sent', 'collecting'), true);
assert.equal(nextKeyboard('driver', 'nt_12345678', 'sent')[0][0].text, '✅ Рейс принят');
assert.equal(nextKeyboard('warehouse', 'nt_12345678', 'ready')[0][0].text, '🚛 Машина загружена');
assert.deepEqual(parseStatusCallback('st|d|accepted|nt_12345678'), {
  actor: 'driver',
  status: 'accepted',
  notificationId: 'nt_12345678'
});
assert.equal(STATUS_LABELS.completed, 'Рейс завершён');

function createSendDb({ bound = true } = {}) {
  let notification = null;
  return {
    prepare(sql) {
      const statement = String(sql);
      return {
        bind(...values) {
          return {
            async first() {
              if (statement.includes('FROM chat_bindings_v2')) {
                return bound ? {
                  warehouse_id: values[2], entity_type: values[3], entity_id: values[4],
                  chat_id: '777001', active: 1,
                } : null;
              }
              if (statement.includes('FROM notifications_v2')) return notification;
              return null;
            },
            async run() {
              if (statement.includes('INSERT OR IGNORE INTO notifications_v2')) {
                notification = {
                  installation_id: values[0], company_id: values[1], warehouse_id: values[2],
                  id: values[3], route_id: values[4], actor: values[5], entity_type: values[6],
                  entity_id: values[7], chat_id: values[8], message_id: null,
                  idempotency_key: values[9], status: 'sending', status_at: values[10],
                  lease_until: values[11], payload_json: values[12], error: '',
                };
                return { meta: { changes: 1 } };
              }
              if (statement.includes("UPDATE notifications_v2") && statement.includes('SET message_id=')) {
                notification = { ...notification, message_id: values[0], status: 'sent', status_at: values[1] };
                return { meta: { changes: 1 } };
              }
              if (statement.includes("UPDATE notifications_v2 SET status='error'")) {
                notification = { ...notification, status: 'error', error: values[0], status_at: values[1] };
                return { meta: { changes: 1 } };
              }
              if (statement.includes('INSERT INTO events_v2')) return { meta: { changes: 1, last_row_id: 1 } };
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function sendRequest() {
  return new Request('https://worker.test/v1/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      actor: 'warehouse', entity_type: 'warehouse', entity_id: 'warehouse_01',
      warehouse_id: 'live--warehouse_01', route_id: 'route_01',
      idempotency_key: 'route:warehouse_01:route_01:v1', text: 'Проверка доставки',
    }),
  });
}

await assert.rejects(
  dispatch(sendRequest(), { ...env, DB: createSendDb({ bound: false }) }),
  error => error?.status === 404 && error?.code === 'chat_not_bound',
);

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: { message_id: 901 } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  const sentResponse = await dispatch(sendRequest(), { ...env, DB: createSendDb() });
  const sentPayload = await sentResponse.json();
  assert.equal(sentPayload.ok, true);
  assert.equal(sentPayload.notification.status, 'sent');
  assert.equal(sentPayload.notification.message_id, 901);
  assert.match(sentPayload.notification.id, /^nt_/);

  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: {} }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    dispatch(sendRequest(), { ...env, DB: createSendDb() }),
    error => error?.status === 502 && error?.code === 'telegram_delivery_unconfirmed',
  );
} finally {
  globalThis.fetch = originalFetch;
}

function createDeprovisionDb({ legacyConflict = false } = {}) {
  let marker = null;
  const rows = {
    chat_bindings_v2: 2,
    link_codes_v2: 1,
    notifications_v2: 3,
    events_v2: 4,
    telegram_updates_v2: 5,
    chat_bindings: 6,
    link_codes: 7,
    notifications: 8,
    events: 9,
    telegram_updates: 10,
    telegram_provisioning_operations: 1,
  };
  function statement(sql, values = []) {
    const source = String(sql);
    return {
      bind(...nextValues) { return statement(source, nextValues); },
      async first() {
        if (source.includes('FROM telegram_deprovision_markers')) return marker;
        if (source.includes('SELECT 1 AS conflict')) return legacyConflict ? { conflict: 1 } : null;
        return null;
      },
      async run() {
        if (source.includes('INSERT INTO telegram_deprovision_markers')) {
          if (!marker) {
            marker = {
              installation_id: values[0], company_id: values[1], warehouse_id: values[2],
              status: 'deprovisioning', attempt_count: 1, last_error_code: '',
              requested_at: values[3], deprovisioned_at: null, updated_at: values[3],
            };
          } else if (marker.status === 'deprovisioning') {
            marker = { ...marker, attempt_count: marker.attempt_count + 1, last_error_code: '', updated_at: values[3] };
          }
          return { meta: { changes: 1 } };
        }
        if (source.includes('SET last_error_code=')) {
          marker = { ...marker, last_error_code: values[0], updated_at: values[1] };
          return { meta: { changes: 1 } };
        }
        if (source.includes("SET status='deprovisioned'")) {
          marker = { ...marker, status: 'deprovisioned', last_error_code: '', deprovisioned_at: values[0], updated_at: values[0] };
          return { meta: { changes: 1 } };
        }
        for (const table of Object.keys(rows)) {
          if (source.includes(`DELETE FROM ${table}`)) {
            const changes = rows[table];
            rows[table] = 0;
            return { meta: { changes } };
          }
        }
        return { meta: { changes: 0 } };
      },
    };
  }
  return {
    prepare: sql => statement(sql),
    async batch(statements) { return Promise.all(statements.map(item => item.run())); },
    state: () => ({ marker, rows: { ...rows } }),
  };
}

const ambiguousLegacyDb = createDeprovisionDb({ legacyConflict: true });
let ambiguousLegacyFetchCalls = 0;
try {
  globalThis.fetch = async () => {
    ambiguousLegacyFetchCalls += 1;
    throw new Error('deleteWebhook must not run for ambiguous legacy ownership');
  };
  await assert.rejects(
    dispatch(new Request('https://worker.test/v1/deprovision', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientKey}` },
    }), { ...env, DB: ambiguousLegacyDb }),
    error => error?.status === 409 && error?.code === 'telegram_legacy_ownership_ambiguous',
  );
  assert.equal(ambiguousLegacyFetchCalls, 0);
  assert.equal(ambiguousLegacyDb.state().marker.last_error_code, 'telegram_legacy_ownership_ambiguous');
  assert.equal(ambiguousLegacyDb.state().rows.chat_bindings, 6);
} finally {
  globalThis.fetch = originalFetch;
}

const unconfirmedDeprovisionDb = createDeprovisionDb();
try {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, result: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    dispatch(new Request('https://worker.test/v1/deprovision', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientKey}` },
    }), { ...env, DB: unconfirmedDeprovisionDb }),
    error => error?.status === 502 && error?.code === 'telegram_disconnect_unconfirmed',
  );
  assert.equal(unconfirmedDeprovisionDb.state().marker.status, 'deprovisioning');
  assert.equal(unconfirmedDeprovisionDb.state().marker.last_error_code, 'telegram_disconnect_unconfirmed');
  assert.equal(unconfirmedDeprovisionDb.state().rows.chat_bindings_v2, 2);
} finally {
  globalThis.fetch = originalFetch;
}

const deprovisionDb = createDeprovisionDb();
const deprovisionEnv = { ...env, DB: deprovisionDb };
let deleteWebhookCalls = 0;
try {
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/deleteWebhook$/);
    assert.equal(JSON.parse(String(options?.body || '{}')).drop_pending_updates, true);
    deleteWebhookCalls += 1;
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  await assert.rejects(
    dispatch(new Request('https://worker.test/v1/deprovision', { method: 'POST' }), deprovisionEnv),
    error => error?.status === 401 && error?.code === 'unauthorized',
  );
  const firstDeprovision = await dispatch(new Request('https://worker.test/v1/deprovision', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientKey}` },
  }), deprovisionEnv);
  const firstDeprovisionPayload = await firstDeprovision.json();
  assert.equal(firstDeprovisionPayload.deprovisioned, true);
  assert.equal(firstDeprovisionPayload.already_deprovisioned, false);
  assert.equal(firstDeprovisionPayload.installation_id, env.INSTALLATION_ID);
  assert.equal(firstDeprovisionPayload.company_id, env.COMPANY_ID);
  assert.equal(firstDeprovisionPayload.warehouse_id, env.WAREHOUSE_ID);
  assert.deepEqual(firstDeprovisionPayload.purged, {
    bindings: 2, link_codes: 1, notifications: 3, events: 4, updates: 5,
    legacy_bindings: 6, legacy_link_codes: 7, legacy_notifications: 8,
    legacy_events: 9, legacy_updates: 10, provisioning_operations: 1,
  });
  assert.equal(deleteWebhookCalls, 1);
  assert.deepEqual(deprovisionDb.state().rows, {
    chat_bindings_v2: 0, link_codes_v2: 0, notifications_v2: 0, events_v2: 0, telegram_updates_v2: 0,
    chat_bindings: 0, link_codes: 0, notifications: 0, events: 0, telegram_updates: 0,
    telegram_provisioning_operations: 0,
  });

  const repeatedDeprovision = await dispatch(new Request('https://worker.test/v1/deprovision', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientKey}` },
  }), deprovisionEnv);
  assert.equal((await repeatedDeprovision.json()).already_deprovisioned, true);
  assert.equal(deleteWebhookCalls, 1);
  await assert.rejects(
    dispatch(sendRequest(), deprovisionEnv),
    error => error?.status === 410 && error?.code === 'installation_deprovisioned',
  );
  await assert.rejects(
    dispatch(new Request('https://worker.test/telegram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': env.WEBHOOK_SECRET,
      },
      body: JSON.stringify({ update_id: 999, message: { text: '/help' } }),
    }), deprovisionEnv),
    error => error?.status === 410 && error?.code === 'installation_deprovisioned',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log(JSON.stringify({
  ok: true,
  authenticatedBindings: true,
  chatIdNotExposed: true,
  warehouseScopeProtected: true,
  duplicateUpdateIdsIsolated: true,
  driverDeepLinkCommand: true,
  driverAndWarehouseTransitions: true,
  unboundSendRejected: true,
  telegramDeliveryConfirmed: true,
  deprovisionContract: true,
  ambiguousLegacyOwnershipFailsClosed: true,
  deprovisionRequiresWebhookConfirmation: true,
  deprovisionRetrySafe: true,
  deprovisionBlocksRuntime: true
}));
