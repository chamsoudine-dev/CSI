ALTER TABLE missions
  ADD COLUMN IF NOT EXISTS date_debut DATE;

ALTER TABLE mission_affectations
  ADD COLUMN IF NOT EXISTS acceptee_le TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS soumise_le TIMESTAMPTZ;

ALTER TABLE mission_affectations
  DROP CONSTRAINT IF EXISTS mission_affectations_statut_check;

ALTER TABLE mission_affectations
  ADD CONSTRAINT mission_affectations_statut_check
  CHECK (statut IN ('AFFECTEE', 'ACCEPTEE', 'EN_COURS', 'SOUMISE'));