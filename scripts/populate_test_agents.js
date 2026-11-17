#!/usr/bin/env node
/**
 * Script pour peupler la base avec des agents de test
 * - 10 agents CSI pour tester le système
 * - 15 superviseurs régionaux pour superviser
 * - 15 experts innovation pour évaluer le système
 * - Quelques CSI si nécessaire
 */

require('dotenv').config({ path: '.env' });
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const NIGER_REGIONS = [
  'Agadez', 'Diffa', 'Dosso', 'Maradi',
  'Niamey', 'Tahoua', 'Tillabéri', 'Zinder'
];

const CSI_EXAMPLES = [
  { nom: 'CSI Yantala', region: 'Niamey', commune: 'Yantala', type: 'urbaine' },
  { nom: 'CSI Karadjé', region: 'Niamey', commune: 'Karadjé', type: 'urbaine' },
  { nom: 'CSI Gamkalé', region: 'Niamey', commune: 'Gamkalé', type: 'urbaine' },
  { nom: 'CSI Maradi Centre', region: 'Maradi', commune: 'Maradi', type: 'urbaine' },
  { nom: 'CSI Zinder Ville', region: 'Zinder', commune: 'Zinder', type: 'urbaine' },
  { nom: 'CSI Tahoua Centre', region: 'Tahoua', commune: 'Tahoua', type: 'urbaine' },
  { nom: 'CSI Diffa Centre', region: 'Diffa', commune: 'Diffa', type: 'urbaine' },
  { nom: 'CSI Agadez Centre', region: 'Agadez', commune: 'Agadez', type: 'urbaine' },
  { nom: 'CSI Dosso Centre', region: 'Dosso', commune: 'Dosso', type: 'urbaine' },
  { nom: 'CSI Tillabéri Centre', region: 'Tillabéri', commune: 'Tillabéri', type: 'urbaine' },
  { nom: 'CSI Tibiri', region: 'Maradi', commune: 'Tibiri', type: 'rurale' },
  { nom: 'CSI Guidam Roumji', region: 'Maradi', commune: 'Guidam Roumji', type: 'rurale' },
  { nom: 'CSI Magaria', region: 'Zinder', commune: 'Magaria', type: 'rurale' },
  { nom: 'CSI Mirriah', region: 'Zinder', commune: 'Mirriah', type: 'rurale' },
  { nom: 'CSI Konni', region: 'Tahoua', commune: 'Konni', type: 'rurale' },
  { nom: 'CSI Filingué', region: 'Tillabéri', commune: 'Filingué', type: 'rurale' },
  { nom: 'CSI Ouallam', region: 'Tillabéri', commune: 'Ouallam', type: 'rurale' },
  { nom: 'CSI Gaya', region: 'Dosso', commune: 'Gaya', type: 'rurale' },
  { nom: 'CSI Dogondoutchi', region: 'Dosso', commune: 'Dogondoutchi', type: 'rurale' },
  { nom: 'CSI Tchirozérine', region: 'Agadez', commune: 'Tchirozérine', type: 'rurale' }
];

const PRENOMS = [
  'Amadou', 'Fatima', 'Ibrahim', 'Aisha', 'Moussa', 'Zahra', 'Ali', 'Khadija',
  'Ousmane', 'Mariama', 'Hamadou', 'Rabi', 'Sani', 'Hawa', 'Abdou', 'Fati',
  'Mahamadou', 'Salamatou', 'Bello', 'Nana', 'Idrissa', 'Aicha', 'Mamane', 'Hadiza'
];

const NOMS = [
  'Diallo', 'Traore', 'Maiga', 'Souley', 'Gado', 'Harouna', 'Bello', 'Kanta',
  'Seini', 'Abdou', 'Maman', 'Hamani', 'Yacouba', 'Garba', 'Issa', 'Oumarou',
  'Moussa', 'Mahaman', 'Ibro', 'Tassiou', 'Kaka', 'Danladi', 'Boubé', 'Illia'
];

async function hashPassword(pwd) {
  return bcrypt.hash(pwd, 10);
}

async function getRegionId(client, regionName) {
  const { rows } = await client.query('SELECT id FROM regions WHERE nom = $1', [regionName]);
  if (rows[0]) return rows[0].id;
  const { rows: ins } = await client.query('INSERT INTO regions (nom) VALUES ($1) RETURNING id', [regionName]);
  return ins[0].id;
}

async function getCommuneId(client, communeName, regionId) {
  const { rows } = await client.query('SELECT id FROM communes WHERE nom = $1 AND region_id = $2', [communeName, regionId]);
  if (rows[0]) return rows[0].id;
  const { rows: ins } = await client.query(
    'INSERT INTO communes (nom, region_id, type) VALUES ($1, $2, $3) RETURNING id',
    [communeName, regionId, 'urbaine']
  );
  return ins[0].id;
}

async function getOrCreateCsi(client, csiData, regionId, communeId) {
  const { rows } = await client.query('SELECT id FROM csi WHERE nom = $1 AND commune_id = $2', [csiData.nom, communeId]);
  if (rows[0]) return rows[0].id;
  const { rows: ins } = await client.query(
    'INSERT INTO csi (nom, commune_id, latitude, longitude, services, actif) VALUES ($1, $2, $3, $4, $5, true) RETURNING id',
    [csiData.nom, communeId, csiData.lat || null, csiData.lon || null, csiData.services || []]
  );
  return ins[0].id;
}

async function createUser(client, { email, nom, role, csi_id, region_id, password = 'Test1234', cree_par }) {
  const hash = await hashPassword(password);
  const { rows } = await client.query(
    `INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, csi_id, region_id, actif, cree_par)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
     ON CONFLICT (email) DO UPDATE SET nom = EXCLUDED.nom, role = EXCLUDED.role, csi_id = EXCLUDED.csi_id, region_id = EXCLUDED.region_id
     RETURNING id, email, role`,
    [email, nom, hash, role, csi_id || null, region_id || null, cree_par]
  );
  return rows[0];
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('🚀 Début du peuplement des agents de test...\n');

    // Trouver un admin existant pour cree_par
    const { rows: adminRows } = await client.query('SELECT id FROM utilisateurs WHERE role = \'admin\' LIMIT 1');
    const adminId = adminRows[0]?.id || 1;
    console.log(`👤 Admin pour cree_par: ${adminId}\n`);

    // 1. Créer les CSI s'ils n'existent pas
    console.log('📍 Création des CSI...');
    const csiIds = [];
    for (const csi of CSI_EXAMPLES) {
      const regionId = await getRegionId(client, csi.region);
      const communeId = await getCommuneId(client, csi.commune, regionId);
      const csiId = await getOrCreateCsi(client, csi, regionId, communeId);
      csiIds.push({ id: csiId, nom: csi.nom, region: csi.region, commune: csi.commune });
    }
    console.log(`   ${csiIds.length} CSI disponibles\n`);

    // 2. Créer 10 agents CSI (testeurs)
    console.log('👨‍🔬 Création de 10 agents CSI (testeurs)...');
    const agents = [];
    for (let i = 0; i < 10; i++) {
      const csi = csiIds[i % csiIds.length];
      const prenom = PRENOMS[i % PRENOMS.length];
      const nom = NOMS[i % NOMS.length];
      const email = `agent${i+1}@csi-niger.ne`;
      // Get region_id via commune
      const { rows: csiInfo } = await client.query(`
        SELECT co.region_id FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1
      `, [csi.id]);

      const user = await createUser(client, {
        email,
        nom: `${prenom} ${nom}`,
        role: 'agent',
        csi_id: csi.id,
        region_id: csiInfo[0]?.region_id || null,
        cree_par: adminId
      });
      agents.push({ ...user, csi: csi.nom });
      console.log(`   ✅ ${user.nom} (${email}) -> CSI: ${csi.nom}`);
    }

    // 3. Créer 15 superviseurs régionaux
    console.log('\n👨‍💼 Création de 15 superviseurs régionaux...');
    const superviseurs = [];
    for (let i = 0; i < 15; i++) {
      const region = NIGER_REGIONS[i % NIGER_REGIONS.length];
      const regionId = await getRegionId(client, region);
      const prenom = PRENOMS[(i+10) % PRENOMS.length];
      const nom = NOMS[(i+10) % NOMS.length];
      const email = `superviseur${i+1}@csi-niger.ne`;
      const user = await createUser(client, {
        email,
        nom: `${prenom} ${nom}`,
        role: 'superviseur',
        region_id: regionId,
        cree_par: adminId
      });
      superviseurs.push({ ...user, region });
      console.log(`   ✅ ${user.nom} (${email}) -> Région: ${region}`);
    }

    // 4. Créer 15 experts innovation
    console.log('\n💡 Création de 15 experts innovation...');
    const innovateurs = [];
    const innovationRoles = [
      'Expert Santé Numérique', 'Data Scientist Santé', 'Spécialiste Télémédecine',
      'Architecte Système', 'Analyste Données Cliniques', 'Ingénieur DevOps Santé',
      'Chercheur IA Médicale', 'Spécialiste Interopérabilité', 'Coordinateur Innovation',
      'Expert Sécurité Données', 'Designer UX Santé', 'Spécialiste Mobile Health',
      'Analyste Prédictif', 'Expert Blockchain Santé', 'Stratège Digital Health'
    ];

    for (let i = 0; i < 15; i++) {
      const prenom = PRENOMS[(i+20) % PRENOMS.length];
      const nom = NOMS[(i+20) % NOMS.length];
      const email = `innovation${i+1}@csi-niger.ne`;
      const user = await createUser(client, {
        email,
        nom: `${prenom} ${nom}`,
        role: 'superviseur_national', // Rôle large pour voir tout le système
        region_id: null,
        cree_par: adminId
      });
      innovateurs.push({ ...user, specialite: innovationRoles[i] });
      console.log(`   ✅ ${user.nom} (${email}) -> ${innovationRoles[i]}`);
    }

    console.log('\n🎉 Peuplement terminé avec succès !');
    console.log('\n📊 Résumé :');
    console.log(`   - ${agents.length} agents CSI (testeurs terrain)`);
    console.log(`   - ${superviseurs.length} superviseurs régionaux`);
    console.log(`   - ${innovateurs.length} experts innovation`);
    console.log(`   - ${csiIds.length} CSI configurés`);
    console.log('\n🔐 Mot de passe par défaut pour tous : Test1234');
    console.log('\n🌐 Connectez-vous sur http://localhost:3000 avec n\'importe quel compte ci-dessus');

  } catch (err) {
    console.error('❌ Erreur:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();