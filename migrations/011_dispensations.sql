-- ==============================================================================
-- CSI Niger — Migration 011 : Traçabilité des médicaments délivrés aux patients
-- Permet à l'agent de dispenser des médicaments aux patients de son CSI
-- ==============================================================================

CREATE TABLE IF NOT EXISTS dispensations_medicaments (
  id SERIAL PRIMARY KEY,
  csi_id INT REFERENCES csi(id) ON DELETE SET NULL,
  patient_id INT,
  patient_nom TEXT NOT NULL,
  patient_numero TEXT,
  medicament_id INT,
  medicament_nom TEXT NOT NULL,
  forme TEXT,
  dosage TEXT,
  quantite INT NOT NULL DEFAULT 1,
  posologie TEXT,
  motif TEXT,
  agent_id INT,
  agent_nom TEXT,
  date_dispensation DATE NOT NULL DEFAULT CURRENT_DATE,
  cree_le TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispensations_csi ON dispensations_medicaments(csi_id);
CREATE INDEX IF NOT EXISTS idx_dispensations_patient ON dispensations_medicaments(patient_id);
CREATE INDEX IF NOT EXISTS idx_dispensations_med ON dispensations_medicaments(medicament_id);
CREATE INDEX IF NOT EXISTS idx_dispensations_date ON dispensations_medicaments(date_dispensation DESC);
