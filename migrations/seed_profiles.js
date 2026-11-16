const bcrypt = require('bcrypt');
const { pool } = require('../src/config/database');

async function seedProfiles() {
  console.log('Seeding demo profiles and CSI...');
  
  // 1. Communes de base
  const regions = await pool.query('SELECT id, nom FROM regions');
  for (const r of regions.rows) {
    const comCheck = await pool.query('SELECT id FROM communes WHERE nom = $1', [r.nom + ' Centre']);
    if (!comCheck.rows.length) {
      await pool.query('INSERT INTO communes (nom, region_id, type) VALUES ($1, $2, $3)', [r.nom + ' Centre', r.id, 'urbaine']);
    }
  }
  
  // 2. CSI de base
  const commRes = await pool.query('SELECT c.id, c.nom, r.id as region_id, r.nom as reg_nom FROM communes c JOIN regions r ON r.id = c.region_id');
  for (const c of commRes.rows) {
    const csiNom = 'CSI ' + c.reg_nom + ' Central';
    const csiCheck = await pool.query('SELECT id FROM csi WHERE nom = $1', [csiNom]);
    if (!csiCheck.rows.length) {
      await pool.query(
        "INSERT INTO csi (nom, commune_id, latitude, longitude, services) VALUES ($1, $2, 13.5, 2.1, ARRAY['Consultation', 'Vaccination', 'Maternité', 'Pharmacie'])",
        [csiNom, c.id]
      );
    }
  }

  // 3. Superviseur et Agent avec mots de passe connus
  const hash = await bcrypt.hash('Pass@CSI2024', 10);
  
  const dossoReg = (await pool.query("SELECT id FROM regions WHERE nom ILIKE 'Dosso'")).rows[0]?.id;
  const csi1 = (await pool.query('SELECT id FROM csi LIMIT 1')).rows[0]?.id;

  await pool.query(`
    INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, region_id, actif)
    VALUES ('superviseur.dosso@csi-niger.ne', 'Superviseur Dosso', $1, 'superviseur', $2, true)
    ON CONFLICT (email) DO UPDATE SET mot_de_passe_hash = $1, region_id = $2, actif = true
  `, [hash, dossoReg]);

  await pool.query(`
    INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, csi_id, actif)
    VALUES ('agent.centre@csi-niger.ne', 'Agent de Santé CSI', $1, 'agent', $2, true)
    ON CONFLICT (email) DO UPDATE SET mot_de_passe_hash = $1, csi_id = $2, actif = true
  `, [hash, csi1]);

  // Donner aussi un csi_id à l'agent chamsou s'il n'en a pas
  await pool.query("UPDATE utilisateurs SET csi_id = $1 WHERE email = 'chamsou@gmail.com' AND csi_id IS NULL", [csi1]);

  console.log('✅ Profils et CSI configurés avec succès !');
  process.exit(0);
}

seedProfiles().catch(e => {
  console.error('Erreur seed profiles:', e);
  process.exit(1);
});
