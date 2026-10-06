-- ============================================================
-- Migration 001 — Schéma initial renforcé
-- CSI Niger v2.0
-- ============================================================

-- Table de suivi des migrations
CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  fichier TEXT UNIQUE NOT NULL,
  applique_le TIMESTAMPTZ DEFAULT now()
);

-- ─── Régions ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS regions (
  id  SERIAL PRIMARY KEY,
  nom TEXT UNIQUE NOT NULL CHECK (length(trim(nom)) > 0)
);

-- ─── Communes ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS communes (
  id        SERIAL PRIMARY KEY,
  nom       TEXT NOT NULL CHECK (length(trim(nom)) > 0),
  region_id INT  NOT NULL REFERENCES regions(id) ON DELETE RESTRICT,
  type      TEXT NOT NULL DEFAULT 'rurale' CHECK (type IN ('rurale', 'urbaine')),
  UNIQUE (nom, region_id)
);

-- ─── CSI ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS csi (
  id          SERIAL PRIMARY KEY,
  nom         TEXT    NOT NULL CHECK (length(trim(nom)) > 0),
  commune_id  INT     NOT NULL REFERENCES communes(id) ON DELETE RESTRICT,
  latitude    NUMERIC(9, 6),
  longitude   NUMERIC(9, 6),
  services    TEXT[]  NOT NULL DEFAULT '{}',
  actif       BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_le  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nom, commune_id),
  CHECK (latitude  IS NULL OR (latitude  BETWEEN -90  AND 90)),
  CHECK (longitude IS NULL OR (longitude BETWEEN -180 AND 180))
);

-- ─── Rapports ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rapports (
  id      SERIAL PRIMARY KEY,
  csi_id  INT  NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
  mois    DATE NOT NULL,
  maj     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (csi_id, mois)
);

-- ─── Consultations ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultations (
  rapport_id INT  NOT NULL REFERENCES rapports(id) ON DELETE CASCADE,
  motif      TEXT NOT NULL CHECK (length(trim(motif)) > 0),
  tranche    TEXT NOT NULL CHECK (tranche IN ('moins5', '5plus')),
  sexe       TEXT NOT NULL CHECK (sexe IN ('M', 'F')),
  nombre     INT  NOT NULL DEFAULT 0 CHECK (nombre >= 0),
  PRIMARY KEY (rapport_id, motif, tranche, sexe)
);

-- ─── Vaccinations ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vaccinations (
  rapport_id INT  NOT NULL REFERENCES rapports(id) ON DELETE CASCADE,
  vaccin     TEXT NOT NULL CHECK (length(trim(vaccin)) > 0),
  doses      INT  NOT NULL DEFAULT 0 CHECK (doses >= 0),
  PRIMARY KEY (rapport_id, vaccin)
);

-- ─── Médicaments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS medicaments (
  rapport_id    INT  NOT NULL REFERENCES rapports(id) ON DELETE CASCADE,
  produit       TEXT NOT NULL CHECK (length(trim(produit)) > 0),
  stock_debut   INT  NOT NULL DEFAULT 0 CHECK (stock_debut   >= 0),
  entrees       INT  NOT NULL DEFAULT 0 CHECK (entrees       >= 0),
  sorties       INT  NOT NULL DEFAULT 0 CHECK (sorties       >= 0),
  stock_fin     INT  NOT NULL DEFAULT 0 CHECK (stock_fin     >= 0),
  jours_rupture INT  NOT NULL DEFAULT 0 CHECK (jours_rupture >= 0),
  PRIMARY KEY (rapport_id, produit)
);

-- ─── Index de performance ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_rapports_mois    ON rapports(mois);
CREATE INDEX IF NOT EXISTS idx_rapports_csi     ON rapports(csi_id);
CREATE INDEX IF NOT EXISTS idx_csi_commune      ON csi(commune_id);
CREATE INDEX IF NOT EXISTS idx_csi_actif        ON csi(actif);
CREATE INDEX IF NOT EXISTS idx_communes_region  ON communes(region_id);
CREATE INDEX IF NOT EXISTS idx_csi_nom_search   ON csi USING gin(to_tsvector('simple', nom));

-- ─── Données initiales — 8 régions du Niger ───────────────────────────────────
INSERT INTO regions (nom)
VALUES
  ('Agadez'), ('Diffa'), ('Dosso'), ('Maradi'),
  ('Niamey'), ('Tahoua'), ('Tillabéri'), ('Zinder')
ON CONFLICT (nom) DO NOTHING;
