const fs = require('fs');

const text = fs.readFileSync('catalogue_niger.csv', 'utf8');
const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
const headers = lines[0].split(',');

function clean(v) {
  if (!v || v === '—' || v === '?' || v === '—?' || v.startsWith('—')) return null;
  return v.trim() || null;
}

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

let sql = `-- ============================================================
-- SCRIPT COMPLET PGADMIN : CATALOGUE DES MÉDICAMENTS DU NIGER
-- Base de données cible : csi_niger
-- ============================================================

-- 1. Création des tables
CREATE TABLE IF NOT EXISTS catalogue_substances (
    id           SERIAL PRIMARY KEY,
    dci          TEXT NOT NULL UNIQUE,
    code_atc     TEXT,
    classe       TEXT,
    cree_le      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS catalogue_medicaments (
    id               SERIAL PRIMARY KEY,
    substance_id     INT REFERENCES catalogue_substances(id) ON DELETE CASCADE,
    nom_commercial   TEXT,
    forme            TEXT,
    dosage           TEXT,
    classe           TEXT,
    sur_ordonnance   BOOLEAN DEFAULT FALSE,
    disponible_niger BOOLEAN DEFAULT TRUE,
    verifie          BOOLEAN DEFAULT FALSE,
    cree_le          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(substance_id, forme, dosage)
);

CREATE INDEX IF NOT EXISTS idx_cat_sub_dci ON catalogue_substances(LOWER(dci));
CREATE INDEX IF NOT EXISTS idx_cat_med_sub ON catalogue_medicaments(substance_id);
CREATE INDEX IF NOT EXISTS idx_cat_med_nom ON catalogue_medicaments(LOWER(nom_commercial));

BEGIN;

`;

const rows = lines.slice(1).map(line => {
  const cols = [];
  let inQ = false, cur = '';
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
    else cur += ch;
  }
  cols.push(cur);
  const row = {};
  headers.forEach((h, i) => { row[h.trim()] = (cols[i] || '').trim(); });
  return row;
});

const substancesMap = new Map();
rows.forEach(r => {
  const dci = clean(r.dci);
  if (!dci) return;
  if (!substancesMap.has(dci)) {
    substancesMap.set(dci, { dci, atc: clean(r.atc), classe: clean(r.classe) });
  }
});

sql += '-- 2. Insertion des Substances Actives (DCI)\n';
for (const s of substancesMap.values()) {
  sql += `INSERT INTO catalogue_substances (dci, code_atc, classe) VALUES (${sqlStr(s.dci)}, ${sqlStr(s.atc)}, ${sqlStr(s.classe)}) ON CONFLICT (dci) DO UPDATE SET code_atc = EXCLUDED.code_atc, classe = EXCLUDED.classe;\n`;
}

sql += '\n-- 3. Insertion des Formes Galéniques & Médicaments Homologués\n';
rows.forEach(r => {
  const dci = clean(r.dci);
  if (!dci) return;
  const dosage = clean(r.dosage);
  const forme = clean(r.forme);
  const classe = clean(r.classe);
  const ordo = (r.ordonnance || '').trim().toUpperCase() === 'O';
  const name = dci.charAt(0).toUpperCase() + dci.slice(1);
  const nomCom = dosage ? `${name} ${dosage}` : name;

  sql += `INSERT INTO catalogue_medicaments (substance_id, nom_commercial, forme, dosage, classe, sur_ordonnance, disponible_niger, verifie) ` +
         `SELECT id, ${sqlStr(nomCom)}, ${sqlStr(forme)}, ${sqlStr(dosage)}, ${sqlStr(classe)}, ${ordo}, TRUE, TRUE ` +
         `FROM catalogue_substances WHERE dci = ${sqlStr(dci)} ` +
         `ON CONFLICT (substance_id, forme, dosage) DO UPDATE SET nom_commercial = EXCLUDED.nom_commercial, classe = EXCLUDED.classe, sur_ordonnance = EXCLUDED.sur_ordonnance;\n`;
});

sql += `
COMMIT;

-- Contrôle des données insérées :
SELECT count(*) AS total_substances FROM catalogue_substances;
SELECT count(*) AS total_medicaments FROM catalogue_medicaments;
`;

fs.writeFileSync('import_pgadmin_complet.sql', sql, 'utf8');
console.log('✅ Fichier import_pgadmin_complet.sql mis à jour en UTF-8.');
