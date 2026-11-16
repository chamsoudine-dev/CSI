-- Authentification renforcée, codes de vérification et révocation des sessions.
ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS telephone TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp TEXT,
  ADD COLUMN IF NOT EXISTS poste TEXT,
  ADD COLUMN IF NOT EXISTS canal_2fa TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS statut_2fa BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS session_version INT NOT NULL DEFAULT 0;

UPDATE utilisateurs
SET canal_2fa = 'email',
    statut_2fa = FALSE,
    session_version = COALESCE(session_version, 0);

ALTER TABLE utilisateurs
  ALTER COLUMN canal_2fa SET DEFAULT 'email',
  ALTER COLUMN canal_2fa SET NOT NULL,
  ALTER COLUMN statut_2fa SET DEFAULT FALSE,
  ALTER COLUMN statut_2fa SET NOT NULL,
  ALTER COLUMN session_version SET DEFAULT 0,
  ALTER COLUMN session_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_utilisateurs_canal_2fa'
  ) THEN
    ALTER TABLE utilisateurs
      ADD CONSTRAINT chk_utilisateurs_canal_2fa CHECK (canal_2fa = 'email');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_verification_codes (
  id BIGSERIAL PRIMARY KEY,
  challenge_id UUID NOT NULL UNIQUE,
  user_id INT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (
    purpose IN ('login_mfa', 'password_change', 'password_reset', 'mfa_setup', 'mfa_disable')
  ),
  code_hash TEXT NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  ip_adresse TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_codes_user_purpose_date
  ON auth_verification_codes(user_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expiry
  ON auth_verification_codes(expires_at);
