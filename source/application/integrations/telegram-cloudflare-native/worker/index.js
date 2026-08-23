import { constantTimeEqual, randomId, randomLinkCode, sha256Hex } from './crypto.js';
import { HttpError, bearerToken, corsPreflight, errorResponse, json, readJson, requireString, requireWarehouseId, routeParts, withCors } from './http.js';
import {
  beginInstallationDeprovision,
  claimTelegramUpdate,
  cleanupExpiredData,
  completeInstallationDeprovision,
  completeTelegramUpdate,
  failTelegramUpdate,
  getInstallationDeprovisionMarker,
  hasLegacyWarehouseOwnershipConflict,
  insertEvent,
  recordInstallationDeprovisionFailure,
  resolveChatBinding
} from './db.js';
import { canTransition, nextKeyboard, parseStatusCallback, STATUS_LABELS } from './status.js';
import { answerCallbackQuery, deleteWebhook, editMessageReplyMarkup, getMe, getWebhookInfo, sendMessage } from './telegram.js';

const MAX_MESSAGE_LENGTH = 3900;
const SEND_LEASE_MS = 60_000;

function nowIso() { return new Date().toISOString(); }

function serviceConfigOk(env) {
  return Boolean(
    env.DB && env.BOT_TOKEN && env.WEBHOOK_SECRET && env.CLIENT_API_KEY && env.BOT_USERNAME
      && env.INSTALLATION_ID && env.COMPANY_ID && env.WAREHOUSE_ID
  );
}

function requireServiceConfig(env) {
  if (!serviceConfigOk(env)) throw new HttpError(503, 'Cloudflare Worker настроен не полностью', 'service_not_configured');
}

function requireApiAccess(request, env) {
  requireServiceConfig(env);
  const supplied = bearerToken(request);
  if (!supplied || !constantTimeEqual(supplied, env.CLIENT_API_KEY)) {
    throw new HttpError(401, 'Ключ подключения недействителен', 'unauthorized');
  }
}

function serviceScope(env) {
  requireServiceConfig(env);
  return {
    installationId: String(env.INSTALLATION_ID),
    companyId: String(env.COMPANY_ID),
    warehouseId: requireWarehouseId(env.WAREHOUSE_ID)
  };
}

function deprovisionBlockedError(marker) {
  const complete = marker?.status === 'deprovisioned';
  return new HttpError(
    410,
    complete ? 'Telegram-установка удалена' : 'Telegram-установка отключается',
    complete ? 'installation_deprovisioned' : 'installation_deprovisioning'
  );
}

async function requireInstallationActive(env) {
  const scope = serviceScope(env);
  const marker = await getInstallationDeprovisionMarker(env.DB, scope);
  if (marker) throw deprovisionBlockedError(marker);
  return scope;
}

function publicDeprovisionResult(scope, alreadyDeprovisioned, purged = null) {
  return {
    ok: true,
    deprovisioned: true,
    already_deprovisioned: alreadyDeprovisioned === true,
    installation_id: scope.installationId,
    company_id: scope.companyId,
    warehouse_id: scope.warehouseId,
    ...(purged ? { purged } : {})
  };
}

async function handleDeprovision(request, env) {
  requireApiAccess(request, env);
  const scope = serviceScope(env);
  const existing = await getInstallationDeprovisionMarker(env.DB, scope);
  if (existing?.status === 'deprovisioned') {
    return json(publicDeprovisionResult(scope, true));
  }
  const marker = await beginInstallationDeprovision(env.DB, scope);
  if (marker.status === 'deprovisioned') {
    return json(publicDeprovisionResult(scope, true));
  }
  try {
    if (await hasLegacyWarehouseOwnershipConflict(env.DB, scope)) {
      throw new HttpError(
        409,
        'Legacy Telegram-данные этого склада имеют неоднозначного владельца',
        'telegram_legacy_ownership_ambiguous'
      );
    }
    const webhookDeleted = await deleteWebhook(env, { dropPendingUpdates: true });
    if (webhookDeleted !== true) {
      throw new HttpError(502, 'Telegram не подтвердил удаление webhook', 'telegram_disconnect_unconfirmed');
    }
    const result = await completeInstallationDeprovision(env.DB, scope);
    return json(publicDeprovisionResult(scope, result.alreadyDeprovisioned, result.purged));
  } catch (error) {
    await recordInstallationDeprovisionFailure(env.DB, scope, error?.code || 'telegram_deprovision_failed');
    throw error;
  }
}

function requireScopedWarehouse(value, env) {
  const warehouseId = requireWarehouseId(value);
  if (warehouseId !== String(env.WAREHOUSE_ID || '')) {
    throw new HttpError(403, 'Этот Worker обслуживает другой склад', 'warehouse_scope_forbidden');
  }
  return warehouseId;
}

function telegramChatMeta(message) {
  const chat = message?.chat || {};
  const from = message?.from || {};
  return {
    chatId: String(chat.id || ''),
    chatType: String(chat.type || ''),
    title: String(chat.title || [from.first_name, from.last_name].filter(Boolean).join(' ') || ''),
    username: String(from.username || chat.username || ''),
    userId: String(from.id || '')
  };
}

function parseCommand(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^\/([\p{L}0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+(.+))?$/u);
  return match ? { command: match[1].toLowerCase(), argument: String(match[2] || '').trim() } : null;
}

function safeJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function publicNotification(row) {
  return {
    id: row.id,
    warehouse_id: row.warehouse_id,
    route_id: row.route_id,
    actor: row.actor,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    message_id: row.message_id,
    status: row.status,
    status_at: row.status_at,
    error: row.error || ''
  };
}

async function handleStatus(request, env) {
  requireApiAccess(request, env);
  await requireInstallationActive(env);
  const [bot, webhook] = await Promise.all([getMe(env), getWebhookInfo(env)]);
  return json({
    ok: true,
    installation_id: env.INSTALLATION_ID || '',
    bot: { id: String(bot.id), username: bot.username, name: bot.first_name || bot.username },
    webhook: {
      url: webhook.url || '',
      pending_update_count: Number(webhook.pending_update_count || 0),
      last_error_date: webhook.last_error_date || null,
      last_error_message: webhook.last_error_message || ''
    }
  });
}

async function handleDisconnect(request, env) {
  requireApiAccess(request, env);
  await requireInstallationActive(env);
  await deleteWebhook(env);
  return json({ ok: true, disconnected: true });
}

async function handleLinkCode(request, env) {
  requireApiAccess(request, env);
  const scope = await requireInstallationActive(env);
  const body = await readJson(request);
  const entityType = requireString(body.entity_type, 'entity_type', { max: 20 });
  if (!['driver', 'warehouse'].includes(entityType)) {
    throw new HttpError(400, 'entity_type должен быть driver или warehouse', 'validation_error');
  }
  const entityId = requireString(body.entity_id, 'entity_id', { max: 120 });
  const warehouseId = requireScopedWarehouse(body.warehouse_id, env);
  const label = requireString(body.label || '', 'label', { max: 200, allowEmpty: true });
  const requestedTtl = Number(body.ttl_minutes || 20);
  const ttlMinutes = Number.isFinite(requestedTtl) ? Math.min(60, Math.max(5, Math.trunc(requestedTtl))) : 20;
  const code = randomLinkCode(12);
  const id = randomId('ln_');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  await env.DB.prepare(`
    INSERT INTO link_codes_v2 (
      installation_id, company_id, warehouse_id, id, code_hash, entity_type,
      entity_id, label, expires_at, used_at, used_chat_id, created_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL,'',?10)
  `).bind(
    scope.installationId, scope.companyId, warehouseId, id, await sha256Hex(code),
    entityType, entityId, label, expiresAt, createdAt
  ).run();

  const deepLink = entityType === 'driver' ? `https://t.me/${env.BOT_USERNAME}?start=${code}` : '';
  return json({
    ok: true,
    code,
    expires_at: expiresAt,
    warehouse_id: warehouseId,
    entity_type: entityType,
    instructions: entityType === 'driver'
      ? 'Водитель открывает ссылку и нажимает START.'
      : `Добавьте @${env.BOT_USERNAME} в группу склада и отправьте: /подключить_склад ${code}`,
    deep_link: deepLink
  }, 201);
}

async function consumeLinkCode(env, message, code) {
  const scope = serviceScope(env);
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return { ok: false, text: 'Укажите код подключения.' };
  const row = await env.DB.prepare(`
    SELECT * FROM link_codes_v2
    WHERE installation_id=?1 AND company_id=?2 AND warehouse_id=?3 AND code_hash=?4
    LIMIT 1
  `).bind(scope.installationId, scope.companyId, scope.warehouseId, await sha256Hex(normalizedCode)).first();
  if (!row) return { ok: false, text: 'Код подключения недействителен или уже истёк.' };

  const meta = telegramChatMeta(message);
  if (row.used_at) {
    return String(row.used_chat_id || '') === meta.chatId
      ? { ok: true, text: '✅ Подключение уже выполнено.' }
      : { ok: false, text: 'Этот код подключения уже использован.' };
  }
  if (new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, text: 'Код подключения недействителен или уже истёк.' };
  if (row.entity_type === 'driver' && meta.chatType !== 'private') {
    return { ok: false, text: 'Ссылка водителя должна открываться в личном диалоге с ботом.' };
  }
  if (row.entity_type === 'warehouse' && !['group', 'supergroup'].includes(meta.chatType)) {
    return { ok: false, text: 'Код склада нужно отправить именно в Telegram-группе склада.' };
  }

  const usedAt = nowIso();
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE link_codes_v2 SET used_at=?1, used_chat_id=?2
      WHERE installation_id=?3 AND id=?4 AND used_at IS NULL AND expires_at>?1
    `).bind(usedAt, meta.chatId, scope.installationId, row.id),
    env.DB.prepare(`
      INSERT INTO chat_bindings_v2 (
        installation_id, company_id, warehouse_id, entity_type, entity_id,
        chat_id, chat_type, title, username, user_id, active, created_at, updated_at
      )
      SELECT installation_id, company_id, warehouse_id, entity_type, entity_id,
        ?1, ?2, ?3, ?4, ?5, 1, ?6, ?6
      FROM link_codes_v2
      WHERE installation_id=?7 AND id=?8 AND used_at=?6 AND used_chat_id=?1
      ON CONFLICT(installation_id, warehouse_id, entity_type, entity_id) DO UPDATE SET
        chat_id=excluded.chat_id, chat_type=excluded.chat_type, title=excluded.title,
        username=excluded.username, user_id=excluded.user_id, active=1, updated_at=excluded.updated_at
    `).bind(
      meta.chatId, meta.chatType, meta.title || row.label, meta.username, meta.userId,
      usedAt, scope.installationId, row.id
    ),
    env.DB.prepare(`
      INSERT INTO events_v2 (
        installation_id, company_id, warehouse_id, event_type, actor, status,
        route_id, notification_id, chat_id, user_id, username, payload_json, created_at
      )
      SELECT installation_id, company_id, warehouse_id, 'chat_bound', entity_type,
        '', '', '', ?1, ?2, ?3, ?4, ?5
      FROM link_codes_v2
      WHERE installation_id=?6 AND id=?7 AND used_at=?5 AND used_chat_id=?1
    `).bind(meta.chatId, meta.userId, meta.username, JSON.stringify({
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      label: row.label,
      chat_type: meta.chatType
    }), usedAt, scope.installationId, row.id)
  ]);

  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    const current = await env.DB.prepare(`
      SELECT used_chat_id FROM link_codes_v2 WHERE installation_id=?1 AND id=?2
    `).bind(scope.installationId, row.id).first();
    return String(current?.used_chat_id || '') === meta.chatId
      ? { ok: true, text: '✅ Подключение уже выполнено.' }
      : { ok: false, text: 'Код уже использован в другом Telegram-чате.' };
  }

  return {
    ok: true,
    text: row.entity_type === 'driver'
      ? '✅ Водитель подключён автоматически.'
      : '✅ Группа склада подключена автоматически.'
  };
}

async function acquireNotification(env, data) {
  const scope = serviceScope(env);
  const id = randomId('nt_');
  const now = new Date();
  const createdAt = now.toISOString();
  const leaseUntil = new Date(now.getTime() + SEND_LEASE_MS).toISOString();
  await env.DB.prepare(`
    INSERT OR IGNORE INTO notifications_v2 (
      installation_id, company_id, warehouse_id, id, route_id, actor, entity_type,
      entity_id, chat_id, message_id, idempotency_key, status, status_at,
      lease_until, payload_json, error, created_at, updated_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,NULL,?10,'sending',?11,?12,?13,'',?11,?11)
  `).bind(
    scope.installationId, scope.companyId, scope.warehouseId, id, data.routeId,
    data.actor, data.entityType, data.entityId, data.chatId, data.idempotencyKey,
    createdAt, leaseUntil, JSON.stringify(data.payloadSnapshot)
  ).run();

  let row = await env.DB.prepare(`
    SELECT * FROM notifications_v2 WHERE installation_id=?1 AND idempotency_key=?2
  `).bind(scope.installationId, data.idempotencyKey).first();
  if (!row) throw new HttpError(500, 'Не удалось создать запись отправки', 'notification_storage_error');
  if (row.id === id) return { state: 'acquired', row };
  if (!['error', 'sending'].includes(row.status)) return { state: 'duplicate', row };
  if (row.status === 'sending') {
    if (new Date(row.lease_until).getTime() > Date.now()) return { state: 'busy', row };
    await env.DB.prepare(`
      UPDATE notifications_v2
      SET status='unknown', error='Истёк срок отправки: результат Telegram неизвестен',
        status_at=?1, updated_at=?1
      WHERE installation_id=?2 AND id=?3 AND status='sending' AND lease_until<=?1
    `).bind(createdAt, scope.installationId, row.id).run();
    row = await env.DB.prepare(`
      SELECT * FROM notifications_v2 WHERE installation_id=?1 AND id=?2
    `).bind(scope.installationId, row.id).first();
    return { state: 'unknown', row };
  }

  const retry = await env.DB.prepare(`
    UPDATE notifications_v2 SET route_id=?1, actor=?2, entity_type=?3, entity_id=?4,
      chat_id=?5, message_id=NULL, status='sending', status_at=?6, lease_until=?7,
      payload_json=?8, error='', updated_at=?6
    WHERE installation_id=?9 AND id=?10 AND status='error'
  `).bind(
    data.routeId, data.actor, data.entityType, data.entityId, data.chatId,
    createdAt, leaseUntil, JSON.stringify(data.payloadSnapshot), scope.installationId, row.id
  ).run();
  if (Number(retry.meta?.changes || 0) !== 1) return { state: 'busy', row };
  row = await env.DB.prepare(`
    SELECT * FROM notifications_v2 WHERE installation_id=?1 AND id=?2
  `).bind(scope.installationId, row.id).first();
  return { state: 'acquired', row };
}

async function handleSend(request, env) {
  requireApiAccess(request, env);
  const scope = await requireInstallationActive(env);
  const body = await readJson(request, 512 * 1024);
  const actor = requireString(body.actor || 'system', 'actor', { max: 20 });
  if (!['driver', 'warehouse', 'system'].includes(actor)) {
    throw new HttpError(400, 'actor должен быть driver, warehouse или system', 'validation_error');
  }
  const entityType = requireString(body.entity_type, 'entity_type', { max: 20 });
  if (!['driver', 'warehouse'].includes(entityType)) {
    throw new HttpError(400, 'entity_type должен быть driver или warehouse', 'validation_error');
  }
  if (actor !== 'system' && actor !== entityType) {
    throw new HttpError(400, 'actor должен соответствовать entity_type', 'validation_error');
  }
  const entityId = requireString(body.entity_id, 'entity_id', { max: 120 });
  const warehouseId = requireScopedWarehouse(body.warehouse_id, env);
  const idempotencyKey = requireString(body.idempotency_key, 'idempotency_key', { max: 180 });
  const text = requireString(body.text, 'text', { max: MAX_MESSAGE_LENGTH });
  const routeId = requireString(body.route_id || '', 'route_id', { max: 160, allowEmpty: true });

  if (body.chat_id !== undefined) {
    throw new HttpError(400, 'Прямая отправка по chat_id отключена: используйте безопасную привязку', 'direct_chat_forbidden');
  }
  const binding = await resolveChatBinding(env.DB, scope, entityType, entityId);
  if (!binding) {
    throw new HttpError(
      404,
      entityType === 'driver'
        ? 'Водитель ещё не подключён к Telegram-боту'
        : 'Telegram-группа склада ещё не подключена',
      'chat_not_bound'
    );
  }

  const payloadSnapshot = {
    title: String(body.title || '').slice(0, 300),
    entity_type: entityType,
    entity_id: entityId,
    metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata : {}
  };
  const acquired = await acquireNotification(env, {
    warehouseId,
    routeId,
    actor,
    entityType,
    entityId,
    chatId: String(binding.chat_id),
    idempotencyKey,
    payloadSnapshot
  });
  if (acquired.state === 'duplicate') return json({ ok: true, duplicate: true, notification: publicNotification(acquired.row) });
  if (acquired.state === 'busy') throw new HttpError(409, 'Отправка уже выполняется', 'notification_in_progress', publicNotification(acquired.row));
  if (acquired.state === 'unknown') throw new HttpError(409, 'Результат предыдущей отправки неизвестен; проверьте Telegram перед повтором', 'notification_unknown', publicNotification(acquired.row));

  const row = acquired.row;
  const keyboard = body.status_buttons === false ? [] : nextKeyboard(actor, row.id, 'sent');
  try {
    const message = await sendMessage(env, {
      chat_id: row.chat_id,
      text,
      reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined
    });
    const telegramMessageId = Number(message?.message_id);
    if (!Number.isInteger(telegramMessageId) || telegramMessageId <= 0) {
      throw new HttpError(502, 'Telegram не подтвердил идентификатор доставленного сообщения', 'telegram_delivery_unconfirmed');
    }
    const changedAt = nowIso();
    const stored = await env.DB.prepare(`
      UPDATE notifications_v2
      SET message_id=?1, status='sent', status_at=?2, lease_until=?2, updated_at=?2
      WHERE installation_id=?3 AND id=?4 AND status='sending'
    `).bind(telegramMessageId, changedAt, scope.installationId, row.id).run();
    if (Number(stored.meta?.changes || 0) !== 1) {
      throw new HttpError(500, 'Сообщение отправлено, но не удалось зафиксировать результат; требуется проверка', 'notification_commit_unknown');
    }
    await insertEvent(env.DB, scope, {
      event_type: 'notification_sent',
      actor,
      status: 'sent',
      route_id: routeId,
      notification_id: row.id,
      chat_id: row.chat_id,
      payload: payloadSnapshot
    });
    return json({
      ok: true,
      notification: {
        id: row.id,
        route_id: routeId,
        warehouse_id: warehouseId,
        actor,
        entity_type: entityType,
        entity_id: entityId,
        message_id: telegramMessageId,
        status: 'sent',
        status_at: changedAt
      }
    }, 201);
  } catch (error) {
    if (error instanceof HttpError && error.code === 'notification_commit_unknown') throw error;
    await env.DB.prepare(`
      UPDATE notifications_v2 SET status='error', error=?1, status_at=?2, lease_until=?2, updated_at=?2
      WHERE installation_id=?3 AND id=?4 AND status='sending'
    `).bind(String(error?.message || error).slice(0, 1000), nowIso(), scope.installationId, row.id).run();
    throw error;
  }
}

async function handleEvents(request, env) {
  requireApiAccess(request, env);
  const scope = await requireInstallationActive(env);
  const url = new URL(request.url);
  const warehouseId = requireScopedWarehouse(url.searchParams.get('warehouse_id'), env);
  const rawAfter = Number(url.searchParams.get('after_id') || 0);
  const rawLimit = Number(url.searchParams.get('limit') || 100);
  const afterId = Number.isFinite(rawAfter) ? Math.max(0, Math.trunc(rawAfter)) : 0;
  const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.trunc(rawLimit))) : 100;
  const result = await env.DB.prepare(`
    SELECT * FROM events_v2
    WHERE installation_id=?1 AND company_id=?2 AND warehouse_id=?3 AND id>?4
    ORDER BY id ASC LIMIT ?5
  `).bind(scope.installationId, scope.companyId, warehouseId, afterId, limit).all();
  const events = (result.results || []).map(row => ({
    id: row.id,
    warehouse_id: row.warehouse_id,
    event_type: row.event_type,
    actor: row.actor,
    status: row.status,
    route_id: row.route_id,
    notification_id: row.notification_id,
    user_id: row.user_id,
    username: row.username,
    payload: safeJson(row.payload_json),
    created_at: row.created_at
  }));
  return json({ ok: true, warehouse_id: warehouseId, events, next_after_id: events.at(-1)?.id || afterId });
}

async function handleBindings(request, env) {
  requireApiAccess(request, env);
  const scope = await requireInstallationActive(env);
  const url = new URL(request.url);
  const warehouseId = requireScopedWarehouse(url.searchParams.get('warehouse_id'), env);
  const entityType = String(url.searchParams.get('entity_type') || '').trim();
  if (entityType && !['driver', 'warehouse'].includes(entityType)) {
    throw new HttpError(400, 'entity_type должен быть driver или warehouse', 'validation_error');
  }
  const result = await env.DB.prepare(`
    SELECT warehouse_id, entity_type, entity_id, chat_type, title, username, user_id, updated_at
    FROM chat_bindings_v2
    WHERE installation_id=?1 AND company_id=?2 AND warehouse_id=?3
      AND active=1 AND (?4='' OR entity_type=?4)
    ORDER BY entity_type, entity_id
  `).bind(scope.installationId, scope.companyId, warehouseId, entityType).all();
  return json({
    ok: true,
    warehouse_id: warehouseId,
    bindings: (result.results || []).map(row => ({
      warehouse_id: row.warehouse_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      chat_type: row.chat_type,
      title: row.title || '',
      username: row.username || '',
      user_id: row.user_id || '',
      updated_at: row.updated_at
    }))
  });
}

async function handleCallback(env, callback) {
  const scope = serviceScope(env);
  const parsed = parseStatusCallback(callback.data);
  if (!parsed) {
    await answerCallbackQuery(env, callback.id, 'Команда кнопки устарела');
    return;
  }
  const row = await env.DB.prepare(`
    SELECT * FROM notifications_v2 WHERE installation_id=?1 AND id=?2
  `).bind(scope.installationId, parsed.notificationId).first();
  if (!row || row.actor !== parsed.actor) {
    await answerCallbackQuery(env, callback.id, 'Уведомление не найдено');
    return;
  }
  const callbackChatId = String(callback.message?.chat?.id || '');
  if (!callbackChatId || callbackChatId !== String(row.chat_id)) {
    await answerCallbackQuery(env, callback.id, 'Кнопка открыта не в исходном чате');
    return;
  }
  if (row.actor === 'driver') {
    const binding = await resolveChatBinding(env.DB, scope, row.entity_type, row.entity_id);
    const allowedUserId = String(binding?.user_id || '');
    if (allowedUserId && allowedUserId !== String(callback.from?.id || '')) {
      await answerCallbackQuery(env, callback.id, 'Эта кнопка назначена другому водителю');
      return;
    }
  }
  if (!canTransition(row.actor, row.status, parsed.status)) {
    await answerCallbackQuery(env, callback.id, `Текущий статус: ${STATUS_LABELS[row.status] || row.status}`);
    return;
  }

  const changedAt = nowIso();
  const changed = await env.DB.prepare(`
    UPDATE notifications_v2 SET status=?1, status_at=?2, updated_at=?2
    WHERE installation_id=?3 AND id=?4 AND status=?5
  `).bind(parsed.status, changedAt, scope.installationId, row.id, row.status).run();
  if (Number(changed.meta?.changes || 0) !== 1) {
    const current = await env.DB.prepare(`
      SELECT status FROM notifications_v2 WHERE installation_id=?1 AND id=?2
    `).bind(scope.installationId, row.id).first();
    await answerCallbackQuery(env, callback.id, `Статус уже изменён: ${STATUS_LABELS[current?.status] || current?.status || 'неизвестно'}`);
    return;
  }

  const from = callback.from || {};
  await insertEvent(env.DB, scope, {
    event_type: 'status_changed',
    actor: row.actor,
    status: parsed.status,
    route_id: row.route_id,
    notification_id: row.id,
    chat_id: callbackChatId,
    user_id: from.id,
    username: from.username || '',
    payload: {
      previous_status: row.status,
      label: STATUS_LABELS[parsed.status] || parsed.status,
      entity_type: row.entity_type,
      entity_id: row.entity_id
    }
  });

  await answerCallbackQuery(env, callback.id, STATUS_LABELS[parsed.status] || parsed.status);
  const keyboard = nextKeyboard(row.actor, row.id, parsed.status);
  const messageId = callback.message?.message_id;
  if (messageId) {
    try { await editMessageReplyMarkup(env, callbackChatId, messageId, keyboard); }
    catch (error) { console.warn('Cannot edit Telegram markup', String(error?.message || error)); }
  }
}

async function handleMessage(env, message) {
  const command = parseCommand(message.text);
  if (!command) return;
  const meta = telegramChatMeta(message);
  if (command.command === 'start' && command.argument) {
    const linked = await consumeLinkCode(env, message, command.argument);
    await sendMessage(env, { chat_id: meta.chatId, text: linked.text });
    return;
  }
  if (command.command === 'connect' || command.command === 'подключить_склад') {
    const linked = await consumeLinkCode(env, message, command.argument);
    await sendMessage(env, { chat_id: meta.chatId, text: linked.text });
    return;
  }
  if (command.command === 'id') {
    await sendMessage(env, {
      chat_id: meta.chatId,
      text: `Chat ID: ${meta.chatId}\nUser ID: ${meta.userId || 'не применимо'}\nТип чата: ${meta.chatType}`
    });
    return;
  }
  if (command.command === 'help' || command.command === 'start') {
    await sendMessage(env, {
      chat_id: meta.chatId,
      text: [
        'Бот подключён к системе «Заказы и логистика».',
        '',
        '/id — показать Chat ID',
        '/подключить_склад КОД — подключить группу склада',
        '/help — помощь',
        '',
        'Для привязки используйте ссылку или код, созданный программой.'
      ].join('\n')
    });
  }
}

async function handleTelegramWebhook(request, env) {
  requireServiceConfig(env);
  const scope = await requireInstallationActive(env);
  const supplied = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!supplied || !constantTimeEqual(supplied, env.WEBHOOK_SECRET)) {
    throw new HttpError(403, 'Неверная подпись Telegram webhook', 'webhook_forbidden');
  }
  const update = await readJson(request, 1024 * 1024);
  if (!Number.isInteger(update.update_id)) throw new HttpError(400, 'Нет update_id', 'invalid_update');
  const claim = await claimTelegramUpdate(env.DB, scope, update.update_id);
  if (claim.state === 'done') return json({ ok: true, duplicate: true });
  if (claim.state === 'busy') return json({ ok: true, processing: true });
  try {
    if (update.callback_query) await handleCallback(env, update.callback_query);
    else if (update.message) await handleMessage(env, update.message);
    await completeTelegramUpdate(env.DB, scope, update.update_id, claim.claimToken);
    return json({ ok: true });
  } catch (error) {
    await failTelegramUpdate(env.DB, scope, update.update_id, claim.claimToken, error?.message || error);
    throw error;
  }
}

async function dispatch(request, env) {
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return corsPreflight(request);
  const parts = routeParts(request.url);

  if (method === 'GET' && parts.length === 1 && parts[0] === 'health') {
    return json({
      ok: true,
      service: env.SERVICE_NAME || 'Orders & Logistics Telegram',
      configured: serviceConfigOk(env),
      telegram_deprovision_contract: 1,
      installation_id: env.INSTALLATION_ID || '',
      version: env.DEPLOYMENT_VERSION || '7.8.3',
      time: nowIso()
    });
  }
  if (method === 'POST' && parts.length === 1 && parts[0] === 'telegram') return handleTelegramWebhook(request, env);
  if (parts.length === 2 && parts[0] === 'v1') {
    if (method === 'POST' && parts[1] === 'deprovision') return handleDeprovision(request, env);
    if (method === 'GET' && parts[1] === 'status') return handleStatus(request, env);
    if (method === 'POST' && parts[1] === 'disconnect') return handleDisconnect(request, env);
    if (method === 'POST' && parts[1] === 'link-code') return handleLinkCode(request, env);
    if (method === 'POST' && parts[1] === 'send') return handleSend(request, env);
    if (method === 'GET' && parts[1] === 'events') return handleEvents(request, env);
    if (method === 'GET' && parts[1] === 'bindings') return handleBindings(request, env);
  }
  throw new HttpError(404, 'Маршрут не найден', 'not_found');
}

export default {
  async fetch(request, env, ctx) {
    if (serviceConfigOk(env) && ctx?.waitUntil) {
      ctx.waitUntil(cleanupExpiredData(env.DB, serviceScope(env)).catch(error => {
        console.warn('Cleanup failed', String(error?.message || error));
      }));
    }
    try { return withCors(await dispatch(request, env)); }
    catch (error) { return withCors(errorResponse(error)); }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupExpiredData(env.DB, serviceScope(env)));
  }
};

export { dispatch, parseCommand, telegramChatMeta };
