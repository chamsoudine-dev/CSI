-- ==============================================================================
-- CSI Niger — Migration 010 : Référentiels paramétrables en base de données
-- Permet à l'administrateur national d'administrer les motifs, vaccins et services
-- ==============================================================================

CREATE TABLE IF NOT EXISTS referentiel_consultations (
  id     SERIAL PRIMARY KEY,
  motif  TEXT UNIQUE NOT NULL,
  actif  BOOLEAN NOT NULL DEFAULT TRUE,
  ordre  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS referentiel_vaccins (
  id     SERIAL PRIMARY KEY,
  vaccin TEXT UNIQUE NOT NULL,
  actif  BOOLEAN NOT NULL DEFAULT TRUE,
  ordre  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS referentiel_services (
  id     SERIAL PRIMARY KEY,
  nom    TEXT UNIQUE NOT NULL,
  actif  BOOLEAN NOT NULL DEFAULT TRUE,
  ordre  INT NOT NULL DEFAULT 0
);

INSERT INTO referentiel_consultations (motif, ordre) VALUES
  ('Paludisme', 1),
  ('Diarrhée', 2),
  ('Infections respiratoires', 3),
  ('Autres motifs', 4)
ON CONFLICT (motif) DO NOTHING;

INSERT INTO referentiel_vaccins (vaccin, ordre) VALUES
  ('BCG', 1),
  ('Penta 1', 2),
  ('Penta 3', 3),
  ('Polio (VPO3)', 4),
  ('Rougeole', 5),
  ('Fièvre jaune', 6)
ON CONFLICT (vaccin) DO NOTHING;

INSERT INTO referentiel_services (nom, ordre) VALUES
  ('Consultation', 1),
  ('Vaccination', 2),
  ('Maternité', 3),
  ('Nutrition', 4),
  ('Laboratoire', 5),
  ('Pharmacie', 6)
ON CONFLICT (nom) DO NOTHING;
