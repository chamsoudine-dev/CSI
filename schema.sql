CREATE TABLE IF NOT EXISTS regions (id SERIAL PRIMARY KEY, nom TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS communes (
  id SERIAL PRIMARY KEY, nom TEXT NOT NULL, region_id INT NOT NULL REFERENCES regions(id),
  type TEXT NOT NULL DEFAULT 'rurale' CHECK (type IN ('rurale','urbaine')), UNIQUE (nom, region_id));
CREATE TABLE IF NOT EXISTS csi (
  id SERIAL PRIMARY KEY, nom TEXT NOT NULL, commune_id INT NOT NULL REFERENCES communes(id),
  latitude NUMERIC(9,6), longitude NUMERIC(9,6), services TEXT[] DEFAULT '{}',
  actif BOOLEAN DEFAULT TRUE, cree_le TIMESTAMPTZ DEFAULT now(), UNIQUE (nom, commune_id));
CREATE TABLE IF NOT EXISTS rapports (
  id SERIAL PRIMARY KEY, csi_id INT NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
  mois DATE NOT NULL, maj TIMESTAMPTZ DEFAULT now(), UNIQUE (csi_id, mois));
CREATE TABLE IF NOT EXISTS consultations (
  rapport_id INT REFERENCES rapports(id) ON DELETE CASCADE, motif TEXT,
  tranche TEXT CHECK (tranche IN ('moins5','5plus')), sexe TEXT CHECK (sexe IN ('M','F')),
  nombre INT NOT NULL DEFAULT 0 CHECK (nombre >= 0), PRIMARY KEY (rapport_id, motif, tranche, sexe));
CREATE TABLE IF NOT EXISTS vaccinations (
  rapport_id INT REFERENCES rapports(id) ON DELETE CASCADE, vaccin TEXT,
  doses INT NOT NULL DEFAULT 0 CHECK (doses >= 0), PRIMARY KEY (rapport_id, vaccin));
CREATE TABLE IF NOT EXISTS medicaments (
  rapport_id INT REFERENCES rapports(id) ON DELETE CASCADE, produit TEXT,
  stock_debut INT DEFAULT 0, entrees INT DEFAULT 0, sorties INT DEFAULT 0,
  stock_fin INT DEFAULT 0, jours_rupture INT DEFAULT 0, PRIMARY KEY (rapport_id, produit));
INSERT INTO regions (nom) VALUES ('Agadez'),('Diffa'),('Dosso'),('Maradi'),('Niamey'),('Tahoua'),('Tillabéri'),('Zinder') ON CONFLICT DO NOTHING;
