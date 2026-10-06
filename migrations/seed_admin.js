/**
 * Création du premier administrateur — CSI Niger
 * Usage: npm run seed
 * 
 * Crée un utilisateur admin si aucun admin n'existe dans la base.
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const readline = require('readline');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  try {
    // Vérifier si un admin existe déjà
    const { rows } = await client.query("SELECT count(*) FROM utilisateurs WHERE role = 'admin'");
    if (+rows[0].count > 0) {
      console.log('✅ Un administrateur existe déjà. Aucune action nécessaire.');
      return;
    }

    const email    = process.env.ADMIN_EMAIL    || 'admin@csi-niger.ne';
    const password = process.env.ADMIN_PASSWORD || 'Admin@CSI2024';
    const nom      = process.env.ADMIN_NOM      || 'Administrateur National';

    if (password.length < 8) {
      console.error('❌ ADMIN_PASSWORD doit comporter au moins 8 caractères');
      process.exit(1);
    }

    console.log('\n🔐 Création du compte administrateur...');
    console.log(`   Email : ${email}`);
    console.log(`   Nom   : ${nom}`);
    console.log(`   Rôle  : admin`);

    const hash = await bcrypt.hash(password, 12);

    await client.query(
      `INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role)
       VALUES ($1, $2, $3, 'admin')`,
      [email.toLowerCase().trim(), nom, hash]
    );

    console.log('\n✅ Administrateur créé avec succès !');
    console.log('\n⚠️  IMPORTANT : Changez le mot de passe après votre première connexion.');
    console.log(`   Mot de passe initial : ${password}\n`);

  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('\n💥 Échec création admin:', err.message);
  process.exit(1);
});
