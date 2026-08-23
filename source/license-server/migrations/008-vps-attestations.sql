ALTER TABLE companies ADD COLUMN data_api_attestation_secret_ciphertext TEXT;

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES ('008-vps-attestations', datetime('now'));
