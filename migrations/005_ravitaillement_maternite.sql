-- ============================================================
-- Migration 005 : Ravitaillement Médicaments & Santé Maternelle / Néonatale
-- CSI Niger v2.0
-- ============================================================

-- ─── 1. Demandes de Ravitaillement & Gestion des Ruptures ────────────────────
CREATE TABLE IF NOT EXISTS demandes_ravitaillement (
    id                SERIAL PRIMARY KEY,
    numero_commande   TEXT UNIQUE NOT NULL,
    csi_id            INT NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
    demandeur_id      INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
    statut            TEXT NOT NULL DEFAULT 'DEMANDE'
                      CHECK (statut IN ('DEMANDE', 'EN_REVUE', 'APPROUVE', 'EXPEDIE', 'LIVRE', 'REJETE')),
    priorite          TEXT NOT NULL DEFAULT 'NORMALE'
                      CHECK (priorite IN ('NORMALE', 'URGENTE', 'CRITIQUE_RUPTURE')),
    motif             TEXT,
    reponse_notes     TEXT,
    traite_par        INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
    date_demande      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    date_traitement   TIMESTAMPTZ,
    date_livraison    TIMESTAMPTZ,
    cree_le           TIMESTAMPTZ DEFAULT NOW(),
    modifie_le        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_demandes_csi    ON demandes_ravitaillement(csi_id);
CREATE INDEX IF NOT EXISTS idx_demandes_statut ON demandes_ravitaillement(statut);
CREATE INDEX IF NOT EXISTS idx_demandes_date   ON demandes_ravitaillement(date_demande DESC);

-- Lignes de médicaments par demande de ravitaillement
CREATE TABLE IF NOT EXISTS demande_lignes (
    id                 SERIAL PRIMARY KEY,
    demande_id         INT NOT NULL REFERENCES demandes_ravitaillement(id) ON DELETE CASCADE,
    medicament_id      INT NOT NULL REFERENCES catalogue_medicaments(id) ON DELETE RESTRICT,
    quantite_demandee  INT NOT NULL CHECK (quantite_demandee > 0),
    stock_actuel_csi   INT DEFAULT 0,
    quantite_accordee  INT DEFAULT 0 CHECK (quantite_accordee >= 0),
    notes              TEXT
);

CREATE INDEX IF NOT EXISTS idx_lignes_demande ON demande_lignes(demande_id);
CREATE INDEX IF NOT EXISTS idx_lignes_med     ON demande_lignes(medicament_id);


-- ─── 2. Registre des Naissances & Nouveaux-nés ─────────────────────────────────
CREATE TABLE IF NOT EXISTS registre_naissances (
    id                 SERIAL PRIMARY KEY,
    csi_id             INT NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
    enregistre_par     INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
    code_registre      TEXT,
    nom_nouveau_ne     TEXT,
    nom_mere           TEXT NOT NULL,
    age_mere           INT,
    sexe               TEXT NOT NULL CHECK (sexe IN ('M', 'F')),
    date_naissance     DATE NOT NULL,
    heure_naissance    TIME,
    poids_grammes      INT NOT NULL CHECK (poids_grammes >= 400 AND poids_grammes <= 7000),
    taille_cm          NUMERIC(4,1),
    etat_naissance     TEXT NOT NULL DEFAULT 'VIVANT'
                       CHECK (etat_naissance IN ('VIVANT', 'MORT_NE_FRAIS', 'MORT_NE_MACERE')),
    type_accouchement  TEXT NOT NULL DEFAULT 'EUTOCIQUE'
                       CHECK (type_accouchement IN ('EUTOCIQUE', 'DYSTOCIQUE', 'CESARIENNE')),
    bcg_fait           BOOLEAN DEFAULT TRUE,
    vpo0_fait          BOOLEAN DEFAULT TRUE,
    observations       TEXT,
    cree_le            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_naiss_csi   ON registre_naissances(csi_id);
CREATE INDEX IF NOT EXISTS idx_naiss_date  ON registre_naissances(date_naissance DESC);
CREATE INDEX IF NOT EXISTS idx_naiss_sexe  ON registre_naissances(sexe);
CREATE INDEX IF NOT EXISTS idx_naiss_poids ON registre_naissances(poids_grammes);


-- ─── 3. Consultations Prénatales (CPN) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultations_prenatales (
    id                 SERIAL PRIMARY KEY,
    csi_id             INT NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
    enregistre_par     INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
    nom_femme          TEXT NOT NULL,
    age                INT,
    date_consultation  DATE NOT NULL,
    type_cpn           TEXT NOT NULL CHECK (type_cpn IN ('CPN1', 'CPN2', 'CPN3', 'CPN4_PLUS')),
    terme_semaines     INT,
    tpi_paludisme      BOOLEAN DEFAULT FALSE,
    vat_tetanos        BOOLEAN DEFAULT FALSE,
    fer_acide_folique  BOOLEAN DEFAULT TRUE,
    tension_arterielle TEXT,
    grossesse_a_risque BOOLEAN DEFAULT FALSE,
    motif_risque       TEXT,
    observations       TEXT,
    cree_le            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpn_csi   ON consultations_prenatales(csi_id);
CREATE INDEX IF NOT EXISTS idx_cpn_date  ON consultations_prenatales(date_consultation DESC);
CREATE INDEX IF NOT EXISTS idx_cpn_type  ON consultations_prenatales(type_cpn);


-- ─── 4. Consultations Postnatales (CPON) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS consultations_postnatales (
    id                 SERIAL PRIMARY KEY,
    csi_id             INT NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
    enregistre_par     INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
    nom_femme          TEXT NOT NULL,
    date_consultation  DATE NOT NULL,
    type_cpon          TEXT NOT NULL CHECK (type_cpon IN ('CPON1_24H', 'CPON2_J6_J14', 'CPON3_J42')),
    etat_mere          TEXT DEFAULT 'BON',
    etat_bebe          TEXT DEFAULT 'BON',
    allaitement_exclusif BOOLEAN DEFAULT TRUE,
    contraception_postpartum BOOLEAN DEFAULT FALSE,
    complications      TEXT,
    observations       TEXT,
    cree_le            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpon_csi  ON consultations_postnatales(csi_id);
CREATE INDEX IF NOT EXISTS idx_cpon_date ON consultations_postnatales(date_consultation DESC);
