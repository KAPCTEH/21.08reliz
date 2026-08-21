function scopeValues(scope) {
  return [scope.installationId, scope.companyId, scope.warehouseId];
}

export async function insertEvent(db, scope, event) {
  const createdAt = event.created_at || new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO events_v2 (
      installation_id, company_id, warehouse_id, event_type, actor, status,
      route_id, notification_id, chat_id, user_id, username, payload_json, created_at
    ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
  `).bind(
    ...scopeValues(scope),
    event.event_type,
    event.actor || '',
    event.status || '',
    event.route_id || '',
    event.notification_id || '',
    String(event.chat_id || ''),
    String(event.user_id || ''),
    event.username || '',
    JSON.stringify(event.payload || {}),
    createdAt
  ).run();
  return result.meta?.last_row_id || 0;
}

export async function claimTelegramUpdate(db, scope, updateId) {
  const now = new Date();
  const nowIso = now.toISOString();
  const claimToken = crypto.randomUUID();
  await db.prepare(`
    INSERT OR IGNORE INTO telegram_updates_v2 (
      installation_id, company_id, warehouse_id, update_id, status, attempts,
      claim_token, received_at, completed_at, last_error
    ) VALUES (?1,?2,?3,?4,'processing',1,?5,?6,NULL,'')
  `).bind(...scopeValues(scope), updateId, claimToken, nowIso).run();

  const row = await db.prepare(`
    SELECT * FROM telegram_updates_v2
    WHERE installation_id=?1 AND update_id=?2
  `).bind(scope.installationId, updateId).first();
  if (!row) throw new Error('Не удалось зафиксировать Telegram update');
  if (row.status === 'done') return { state: 'done', claimToken: '' };
  if (row.status === 'processing' && row.claim_token === claimToken) {
    return { state: 'claimed', claimToken };
  }

  const staleBefore = new Date(now.getTime() - 120_000).toISOString();
  const takeover = await db.prepare(`
    UPDATE telegram_updates_v2
    SET status='processing', attempts=attempts+1, claim_token=?1, received_at=?2,
      completed_at=NULL, last_error=''
    WHERE installation_id=?3 AND update_id=?4 AND status!='done'
      AND (status!='processing' OR received_at<=?5)
  `).bind(claimToken, nowIso, scope.installationId, updateId, staleBefore).run();
  return Number(takeover.meta?.changes || 0) > 0
    ? { state: 'claimed', claimToken }
    : { state: 'busy', claimToken: '' };
}

export async function completeTelegramUpdate(db, scope, updateId, claimToken) {
  return db.prepare(`
    UPDATE telegram_updates_v2 SET status='done', completed_at=?1, last_error=''
    WHERE installation_id=?2 AND update_id=?3 AND status='processing' AND claim_token=?4
  `).bind(new Date().toISOString(), scope.installationId, updateId, claimToken).run();
}

export async function failTelegramUpdate(db, scope, updateId, claimToken, error) {
  return db.prepare(`
    UPDATE telegram_updates_v2 SET status='failed', completed_at=?1, last_error=?2
    WHERE installation_id=?3 AND update_id=?4 AND status='processing' AND claim_token=?5
  `).bind(
    new Date().toISOString(),
    String(error || '').slice(0, 1000),
    scope.installationId,
    updateId,
    claimToken
  ).run();
}

export async function resolveChatBinding(db, scope, entityType, entityId) {
  return db.prepare(`
    SELECT * FROM chat_bindings_v2
    WHERE installation_id=?1 AND company_id=?2 AND warehouse_id=?3
      AND entity_type=?4 AND entity_id=?5 AND active=1
    LIMIT 1
  `).bind(...scopeValues(scope), entityType, entityId).first();
}

export async function cleanupExpiredData(db, scope, now = new Date()) {
  const linkBefore = new Date(now.getTime() - 7 * 86400_000).toISOString();
  const updateBefore = new Date(now.getTime() - 14 * 86400_000).toISOString();
  const eventBefore = new Date(now.getTime() - 90 * 86400_000).toISOString();
  const notificationBefore = new Date(now.getTime() - 180 * 86400_000).toISOString();
  return db.batch([
    db.prepare(`
      DELETE FROM link_codes_v2
      WHERE installation_id=?1 AND (expires_at<?2 OR (used_at IS NOT NULL AND used_at<?2))
    `).bind(scope.installationId, linkBefore),
    db.prepare('DELETE FROM telegram_updates_v2 WHERE installation_id=?1 AND received_at<?2')
      .bind(scope.installationId, updateBefore),
    db.prepare('DELETE FROM events_v2 WHERE installation_id=?1 AND created_at<?2')
      .bind(scope.installationId, eventBefore),
    db.prepare('DELETE FROM notifications_v2 WHERE installation_id=?1 AND created_at<?2')
      .bind(scope.installationId, notificationBefore)
  ]);
}
