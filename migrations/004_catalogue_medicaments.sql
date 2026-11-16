-- ============================================================
-- Migration 004 : Catalogue national des médicaments du Niger
-- Tables séparées du schéma de saisie mensuelle
-- ============================================================

-- Table des substances actives (DCI = Dénomination Commune Internationale)
CREATE TABLE IF NOT EXISTS catalogue_substances (
    id           SERIAL PRIMARY KEY,
    dci          TEXT NOT NULL UNIQUE,
    code_atc     TEXT,
    classe       TEXT,
    cree_le      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cat_sub_dci   ON catalogue_substances (LOWER(dci));
CREATE INDEX IF NOT EXISTS idx_cat_sub_classe ON catalogue_substances (classe);
CREATE INDEX IF NOT EXISTS idx_cat_sub_atc   ON catalogue_substances (code_atc) WHERE code_atc IS NOT NULL;

-- Table du catalogue médicaments (formes galéniques par substance)
CREATE TABLE IF NOT EXISTS catalogue_medicaments (
    id               SERIAL PRIMARY KEY,
    substance_id     INT REFERENCES catalogue_substances(id) ON DELETE CASCADE,
    nom_commercial   TEXT,           -- ex: "artémether-luméfantrine 20 mg/120 mg"
    forme            TEXT,           -- ex: "comprimé", "injectable", "sirop"
    dosage           TEXT,           -- ex: "20 mg/120 mg"
    classe           TEXT,
    sur_ordonnance   BOOLEAN DEFAULT FALSE,
    disponible_niger BOOLEAN DEFAULT TRUE,
    verifie          BOOLEAN DEFAULT FALSE,
    cree_le          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(substance_id, forme, dosage)
);

CREATE INDEX IF NOT EXISTS idx_cat_med_sub    ON catalogue_medicaments (substance_id);
CREATE INDEX IF NOT EXISTS idx_cat_med_nom    ON catalogue_medicaments (LOWER(nom_commercial));
CREATE INDEX IF NOT EXISTS idx_cat_med_forme  ON catalogue_medicaments (forme);
CREATE INDEX IF NOT EXISTS idx_cat_med_classe ON catalogue_medicaments (classe);
-- Index full-text pour la recherche
CREATE INDEX IF NOT EXISTS idx_cat_med_fts ON catalogue_medicaments
    USING GIN (to_tsvector('french', COALESCE(nom_commercial,'') || ' ' || COALESCE(forme,'') || ' ' || COALESCE(classe,'')));
