-- Security hardening: share ownership and indexed security lookups.
ALTER TABLE shares ADD COLUMN owner_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_shares_owner_user ON shares(owner_user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_security_ip_created ON security_events(ip,created_at);
CREATE INDEX IF NOT EXISTS idx_security_user_action_created ON security_events(user_id,action,created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_type_ip_created ON security_alerts(type,ip,created_at);
