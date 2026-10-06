-- ============================================================
-- Migration 002 — Utilisateurs, rôles et audit
-- CSI Niger v2.0
-- ============================================================

-- ─── Table des utilisateurs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS utilisateurs (
  id                 SERIAL PRIMARY KEY,
  email              TEXT NOT NULL UNIQUE CHECK (email = lower(trim(email))),
  nom                TEXT NOT NULL CHECK (length(trim(nom)) >= 2),
  mot_de_passe_hash  TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'agent'
                     CHECK (role IN ('agent', 'superviseur', 'admin')),
  -- Un agent est lié à un CSI précis (null = pas de restriction)
  csi_id             INT REFERENCES csi(id) ON DELETE SET NULL,
  -- Un superviseur est lié à une région
  region_id          INT REFERENCES regions(id) ON DELETE SET NULL,
  actif              BOOLEAN NOT NULL DEFAULT TRUE,
  derniere_connexion TIMESTAMPTZ,
  cree_le            TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_utilisateurs_email  ON utilisateurs(email);
CREATE INDEX IF NOT EXISTS idx_utilisateurs_role   ON utilisateurs(role);
CREATE INDEX IF NOT EXISTS idx_utilisateurs_csi    ON utilisateurs(csi_id);
CREATE INDEX IF NOT EXISTS idx_utilisateurs_region ON utilisateurs(region_id);

-- ─── Journal d'audit ─────────────────────────────────────────────────────────
-- Enregistre toutes les actions importantes (qui a fait quoi et quand)
CREATE TABLE IF NOT EXISTS audit_log (
  id               SERIAL PRIMARY KEY,
  utilisateur_id   INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  action           TEXT NOT NULL, -- 'LOGIN', 'CREATE_CSI', 'UPDATE_RAPPORT', etc.
  table_cible      TEXT,
  enregistrement_id INT,
  details          JSONB,
  ip_adresse       TEXT,
  cree_le          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_utilisateur ON audit_log(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_audit_action      ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_date        ON audit_log(cree_le);
CREATE INDEX IF NOT EXISTS idx_audit_table       ON audit_log(table_cible, enregistrement_id);

-- ─── Trigger : mise à jour automatique de modifie_le ─────────────────────────
CREATE OR REPLACE FUNCTION update_modifie_le()
RETURNS TRIGGER AS $$
BEGIN
  NEW.modifie_le = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_csi_modifie_le'
  ) THEN
    CREATE TRIGGER trg_csi_modifie_le
      BEFORE UPDATE ON csi
      FOR EACH ROW EXECUTE FUNCTION update_modifie_le();
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_utilisateurs_modifie_le'
  ) THEN
    CREATE TRIGGER trg_utilisateurs_modifie_le
      BEFORE UPDATE ON utilisateurs
      FOR EACH ROW EXECUTE FUNCTION update_modifie_le();
  END IF;
END;
$$;
