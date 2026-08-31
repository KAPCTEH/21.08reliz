CREATE INDEX IF NOT EXISTS idx_sessions_active_user
ON sessions(user_id, company_id)
WHERE status='active';

CREATE INDEX IF NOT EXISTS idx_sessions_active_device
ON sessions(device_id, company_id)
WHERE status='active';
