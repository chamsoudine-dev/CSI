-- Import du catalogue Niger dans le schéma medicaments_niger.sql
-- À lancer dans psql, depuis le dossier contenant catalogue_niger.csv

ALTER TABLE medicaments  ADD COLUMN IF NOT EXISTS verifie BOOLEAN DEFAULT FALSE;
ALTER TABLE medicaments  ADD COLUMN IF NOT EXISTS classe  TEXT;

CREATE TEMP TABLE stg_catalogue (
    dci TEXT, atc TEXT, classe TEXT, dosage TEXT, forme TEXT, ordonnance TEXT
);

\copy stg_catalogue FROM 'catalogue_niger.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')

-- 1) Substances (une ligne par DCI)
INSERT INTO substances (dci, code_atc, classe)
SELECT DISTINCT ON (dci) dci, NULLIF(atc,''), classe
FROM stg_catalogue
ON CONFLICT (dci) DO NOTHING;

-- 2) Médicaments (génériques par DCI + dosage + forme)
INSERT INTO medicaments (nom_commercial, forme, dosage, classe, sur_ordonnance, disponible_niger, verifie)
SELECT initcap(c.dci) || CASE WHEN c.dosage <> '—' THEN ' ' || c.dosage ELSE '' END,
       c.forme, NULLIF(c.dosage,'—'), c.classe, (c.ordonnance = 'O'), TRUE, FALSE
FROM stg_catalogue c
WHERE NOT EXISTS (
    SELECT 1 FROM medicaments m
    WHERE m.nom_commercial = initcap(c.dci) || CASE WHEN c.dosage <> '—' THEN ' ' || c.dosage ELSE '' END
      AND m.forme = c.forme
);

-- 3) Lien médicament <-> substance
INSERT INTO medicament_substances (medicament_id, substance_id, dosage)
SELECT m.id, s.id, m.dosage
FROM stg_catalogue c
JOIN substances s ON s.dci = c.dci
JOIN medicaments m ON m.nom_commercial = initcap(c.dci) || CASE WHEN c.dosage <> '—' THEN ' ' || c.dosage ELSE '' END
                  AND m.forme = c.forme
ON CONFLICT DO NOTHING;

-- Contrôle
SELECT count(*) AS nb_medicaments FROM medicaments WHERE verifie = FALSE;
SELECT count(*) AS nb_substances FROM substances;
