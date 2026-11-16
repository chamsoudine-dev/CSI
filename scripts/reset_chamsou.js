const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:Cham123%40@localhost:5432/csi_niger'
});

async function run() {
  const hash = await bcrypt.hash('Cham123@', 12);
  const res = await pool.query("UPDATE utilisateurs SET mot_de_passe_hash = $1 WHERE email = 'chamsou@gmail.com'", [hash]);
  console.log('Utilisateur mis à jour ! Lignes affectées :', res.rowCount);
  await pool.end();
}

run().catch(console.error);
