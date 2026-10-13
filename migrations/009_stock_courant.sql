-- ==============================================================================
-- CSI Niger — Migration 009 : Table de stock courant par CSI et par médicament
-- Mise à jour automatique lors des réceptions de commandes (LIVRE) et rapports
-- ==============================================================================

CREATE TABLE IF NOT EXISTS stock_courant (
  csi_id         INT NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
  medicament_id  INT NOT NULL REFERENCES catalogue_medicaments(id) ON DELETE CASCADE,
  quantite       INT NOT NULL DEFAULT 0 CHECK (quantite >= 0),
  maj_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (csi_id, medicament_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_courant_csi ON stock_courant(csi_id);
CREATE INDEX IF NOT EXISTS idx_stock_courant_med ON stock_courant(medicament_id);
