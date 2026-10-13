-- ==============================================================================
-- CSI Niger — Migration 007 : Workflow de validation des rapports mensuels & Paramètres
-- Statuts : BROUILLON, SOUMIS, VALIDE, RENVOYE
-- Table parametres pour configuration administrative
-- ==============================================================================

-- ─── Évolution de la table rapports ────────────────────────────────────────────
ALTER TABLE rapports ADD COLUMN IF NOT EXISTS statut VARCHAR(20) NOT NULL DEFAULT 'BROUILLON';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_rapports_statut'
  ) THEN
    ALTER TABLE rapports ADD CONSTRAINT chk_rapports_statut
      CHECK (statut IN ('BROUILLON', 'SOUMIS', 'VALIDE', 'RENVOYE'));
  END IF;
END $$;

ALTER TABLE rapports ADD COLUMN IF NOT EXISTS soumis_le TIMESTAMPTZ;
ALTER TABLE rapports ADD COLUMN IF NOT EXISTS soumis_par INT REFERENCES utilisateurs(id) ON DELETE SET NULL;
ALTER TABLE rapports ADD COLUMN IF NOT EXISTS valide_le TIMESTAMPTZ;
ALTER TABLE rapports ADD COLUMN IF NOT EXISTS valide_par INT REFERENCES utilisateurs(id) ON DELETE SET NULL;
ALTER TABLE rapports ADD COLUMN IF NOT EXISTS commentaire_validation TEXT;

CREATE INDEX IF NOT EXISTS idx_rapports_statut ON rapports(statut);
CREATE INDEX IF NOT EXISTS idx_rapports_soumis_le ON rapports(soumis_le);

-- ─── Table Paramètres Système ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parametres (
  cle VARCHAR(50) PRIMARY KEY,
  valeur TEXT NOT NULL,
  description TEXT,
  modifie_le TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_par INT REFERENCES utilisateurs(id) ON DELETE SET NULL
);

INSERT INTO parametres (cle, valeur, description)
VALUES 
  ('jour_limite_depot_rapport', '5', 'Jour du mois limite pour la transmission du rapport mensuel écoulé (ex: 5)'),
  ('seuil_alerte_epidemie_pct', '50', 'Pourcentage de hausse par rapport à la moyenne trimestrielle déclenchant une alerte épidémiologique (ex: 50)')
ON CONFLICT (cle) DO NOTHING;
