-- ════════════════════════════════════════════════════════════════════════════════
-- MIGRATION 006 — Base de données nationale des patients
-- ════════════════════════════════════════════════════════════════════════════════

-- Table principale des patients (identité unique nationale)
CREATE TABLE IF NOT EXISTS patients (
    id                      SERIAL PRIMARY KEY,
    numero_patient          TEXT UNIQUE NOT NULL,   -- Format : NIG-AAAA-NNNNN (ex: NIG-2024-00001)
    nom                     TEXT NOT NULL,
    prenom                  TEXT,
    sexe                    TEXT CHECK (sexe IN ('M', 'F')),
    date_naissance          DATE,
    lieu_naissance          TEXT,
    commune_residence       TEXT,
    region_id               INT REFERENCES regions(id) ON DELETE SET NULL,
    telephone               TEXT,
    groupe_sanguin          TEXT CHECK (groupe_sanguin IN ('A+','A-','B+','B-','AB+','AB-','O+','O-','Inconnu')),
    allergies               TEXT,
    maladies_chroniques     TEXT,
    csi_inscription_id      INT REFERENCES csi(id) ON DELETE SET NULL,  -- CSI d'enregistrement initial
    enregistre_par_id       INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
    cree_le                 TIMESTAMPTZ DEFAULT NOW(),
    modifie_le              TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_patients_nom        ON patients (LOWER(nom));
CREATE INDEX IF NOT EXISTS idx_patients_prenom     ON patients (LOWER(prenom));
CREATE INDEX IF NOT EXISTS idx_patients_telephone  ON patients (telephone);
CREATE INDEX IF NOT EXISTS idx_patients_csi        ON patients (csi_inscription_id);
CREATE INDEX IF NOT EXISTS idx_patients_region     ON patients (region_id);

-- Recherche full-text sur le nom
CREATE INDEX IF NOT EXISTS idx_patients_fts ON patients
    USING gin(to_tsvector('french', COALESCE(nom, '') || ' ' || COALESCE(prenom, '') || ' ' || COALESCE(lieu_naissance, '')));

-- Table des visites / consultations (dossier médical par visite)
CREATE TABLE IF NOT EXISTS dossiers_consultation (
    id                  SERIAL PRIMARY KEY,
    patient_id          INT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    csi_id              INT NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
    agent_id            INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
    date_visite         DATE NOT NULL DEFAULT CURRENT_DATE,
    motif               TEXT NOT NULL,
    diagnostic          TEXT,
    traitement          TEXT,
    ordonnance          TEXT,
    tension_arterielle  TEXT,    -- ex: "120/80"
    temperature         NUMERIC(4,1),
    poids_kg            NUMERIC(5,2),
    observations        TEXT,
    statut              TEXT DEFAULT 'CONSULTE' CHECK (statut IN ('CONSULTE','HOSPITALISE','REFERE','DECEDE')),
    cree_le             TIMESTAMPTZ DEFAULT NOW()
);

-- Index sur dossiers
CREATE INDEX IF NOT EXISTS idx_dossiers_patient    ON dossiers_consultation (patient_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_csi        ON dossiers_consultation (csi_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_agent      ON dossiers_consultation (agent_id);
CREATE INDEX IF NOT EXISTS idx_dossiers_date       ON dossiers_consultation (date_visite DESC);

-- Séquence pour générer les numéros patients (NIG-AAAA-NNNNN)
CREATE SEQUENCE IF NOT EXISTS patient_numero_seq START 1;

-- Vue nationale des patients avec leur CSI d'inscription
CREATE OR REPLACE VIEW vue_patients_nationale AS
SELECT
    p.id,
    p.numero_patient,
    p.nom,
    p.prenom,
    p.sexe,
    p.date_naissance,
    DATE_PART('year', AGE(p.date_naissance))::INT AS age,
    p.lieu_naissance,
    p.commune_residence,
    r.nom AS region_nom,
    p.telephone,
    p.groupe_sanguin,
    p.allergies,
    p.maladies_chroniques,
    c.nom AS csi_inscription_nom,
    com.nom AS csi_commune,
    u.nom AS enregistre_par_nom,
    p.cree_le,
    p.modifie_le,
    (SELECT COUNT(*) FROM dossiers_consultation dc WHERE dc.patient_id = p.id) AS nb_visites,
    (SELECT MAX(dc.date_visite) FROM dossiers_consultation dc WHERE dc.patient_id = p.id) AS derniere_visite
FROM patients p
LEFT JOIN regions r ON r.id = p.region_id
LEFT JOIN csi c ON c.id = p.csi_inscription_id
LEFT JOIN communes com ON com.id = c.commune_id
LEFT JOIN utilisateurs u ON u.id = p.enregistre_par_id;
