-- ==============================================================================
-- CSI Niger — Migration 008 : Enquête annuelle UNFPA en base de données
-- Permet la saisie décentralisée et la synthèse nationale/régionale
-- ==============================================================================

CREATE TABLE IF NOT EXISTS enquetes_unfpa (
  id          SERIAL PRIMARY KEY,
  csi_id      INT NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
  annee       INT NOT NULL,
  statut      VARCHAR(20) NOT NULL DEFAULT 'BROUILLON',
  reponses    JSONB NOT NULL DEFAULT '{}'::jsonb,
  auteur_id   INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  soumis_le   TIMESTAMPTZ,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (csi_id, annee)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_enquetes_unfpa_statut'
  ) THEN
    ALTER TABLE enquetes_unfpa ADD CONSTRAINT chk_enquetes_unfpa_statut
      CHECK (statut IN ('BROUILLON', 'SOUMIS', 'VALIDE'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_enquetes_unfpa_csi ON enquetes_unfpa(csi_id);
CREATE INDEX IF NOT EXISTS idx_enquetes_unfpa_annee ON enquetes_unfpa(annee);
CREATE INDEX IF NOT EXISTS idx_enquetes_unfpa_statut ON enquetes_unfpa(statut);
