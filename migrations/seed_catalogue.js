#!/usr/bin/env node
/**
 * seed_catalogue.js — Import du catalogue Niger de médicaments
 * Lit catalogue_niger.csv en UTF-8 et insère dans catalogue_substances + catalogue_medicaments
 */

const path = require('path');
const fs = require('fs');
const { pool } = require('../src/config/database');

function clean(v) {
  if (!v || v === '—' || v === '?' || v === '—?' || v.startsWith('—')) return null;
  return v.trim() || null;
}

function nomCommercial(dci, dosage) {
  const d = clean(dosage);
  const name = dci.charAt(0).toUpperCase() + dci.slice(1);
  return d ? `${name} ${d}` : name;
}

async function main() {
  const csvPath = process.env.CATALOGUE_CSV_PATH || path.join(__dirname, '..', 'catalogue_niger.csv');
  if (!fs.existsSync(csvPath)) {
    console.warn(`⚠️ Fichier catalogue introuvable à l'emplacement : ${csvPath} — import ignoré.`);
    return;
  }
  console.log(`📂 Lecture du CSV ${csvPath} (UTF-8)...`);
  
  const text = fs.readFileSync(csvPath, 'utf8');
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  const headers = lines[0].split(',');

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

  console.log(`   → ${rows.length} lignes lues`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Upsert idempotent sans supprimer les données existantes pour préserver l'intégrité référentielle
    let nbSub = 0, nbMed = 0;

    for (const row of rows) {
      const dci      = clean(row.dci);
      const atc      = clean(row.atc);
      const classe   = clean(row.classe);
      const dosage   = clean(row.dosage);
      const forme    = clean(row.forme);
      const ordoRaw  = (row.ordonnance || '').trim().toUpperCase();
      const surOrdo  = ordoRaw === 'O';

      if (!dci) continue;

      // 1) Substance (upsert par dci)
      const subRes = await client.query(`
        INSERT INTO catalogue_substances (dci, code_atc, classe)
        VALUES ($1, $2, $3)
        ON CONFLICT (dci) DO UPDATE
          SET code_atc = COALESCE(EXCLUDED.code_atc, catalogue_substances.code_atc),
              classe   = COALESCE(EXCLUDED.classe,   catalogue_substances.classe)
        RETURNING id
      `, [dci, atc, classe]);
      const subId = subRes.rows[0].id;
      nbSub++;

      // 2) Médicament (upsert par substance + forme + dosage)
      const nom = nomCommercial(dci, dosage);
      await client.query(`
        INSERT INTO catalogue_medicaments
          (substance_id, nom_commercial, forme, dosage, classe, sur_ordonnance, disponible_niger, verifie)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE, TRUE)
        ON CONFLICT (substance_id, forme, dosage) DO UPDATE
          SET nom_commercial   = EXCLUDED.nom_commercial,
              classe           = EXCLUDED.classe,
              sur_ordonnance   = EXCLUDED.sur_ordonnance
      `, [subId, nom, forme, dosage, classe, surOrdo]);
      nbMed++;
    }

    await client.query('COMMIT');

    console.log('\n✅ Import avec accents UTF-8 terminé !');
    const stats = await client.query(`
      SELECT
        (SELECT count(*) FROM catalogue_substances)  AS nb_substances,
        (SELECT count(*) FROM catalogue_medicaments) AS nb_medicaments,
        (SELECT count(DISTINCT classe) FROM catalogue_medicaments WHERE classe IS NOT NULL) AS nb_classes
    `);
    const s = stats.rows[0];
    console.log(`📊 Bilan en base :`);
    console.log(`   Substances : ${s.nb_substances}`);
    console.log(`   Médicaments (formes) : ${s.nb_medicaments}`);
    console.log(`   Classes : ${s.nb_classes}`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur import :', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
