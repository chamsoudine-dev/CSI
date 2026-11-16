/**
 * Script de réinitialisation du mot de passe Administrateur
 */
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function reset() {
  const email = (process.env.ADMIN_EMAIL || 'admin@csi-niger.ne').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || 'Admin@CSI2024';
  const nom = process.env.ADMIN_NOM || 'Administrateur National';

  console.log(`🔐 Réinitialisation du mot de passe pour : ${email}`);

  const hash = await bcrypt.hash(password, 12);
  const client = await pool.connect();
  try {
    const res = await client.query(
      'UPDATE utilisateurs SET mot_de_passe_hash = $1, actif = TRUE WHERE email = $2',
      [hash, email]
    );

    if (res.rowCount === 0) {
      await client.query(
        "INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, actif) VALUES ($1, $2, $3, 'admin', TRUE)",
        [email, nom, hash]
      );
      console.log('✅ Utilisateur administrateur créé avec succès !');
    } else {
      console.log('✅ Mot de passe mis à jour avec succès !');
    }

    console.log(`   Email : ${email}`);
    console.log(`   Mot de passe : ${password}`);
  } finally {
    client.release();
    await pool.end();
  }
}

reset().catch(err => {
  console.error('❌ Erreur:', err);
  process.exit(1);
});
