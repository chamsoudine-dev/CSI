/**
 * Exécuteur de migrations — CSI Niger
 * Lance toutes les migrations SQL dans l'ordre, en évitant les doublons.
 * Usage: npm run migrate
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    // Créer la table de migrations si elle n'existe pas
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        fichier TEXT UNIQUE NOT NULL,
        applique_le TIMESTAMPTZ DEFAULT now()
      )
    `);

    // Lire tous les fichiers .sql dans /migrations, triés par nom
    const dir = path.join(__dirname);
    const files = fs.readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`\n🔄 ${files.length} fichier(s) de migration trouvé(s)\n`);

    for (const file of files) {
      // Vérifier si déjà appliquée
      const { rows } = await client.query('SELECT 1 FROM migrations WHERE fichier = $1', [file]);
      if (rows[0]) {
        console.log(`  ✅ ${file} — déjà appliquée`);
        continue;
      }

      console.log(`  ▶️  ${file} — application en cours...`);
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO migrations (fichier) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`  ✅ ${file} — succès`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ❌ ${file} — ERREUR:`, err.message);
        throw err;
      }
    }

    console.log('\n🎉 Toutes les migrations ont été appliquées.\n');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('\n💥 Échec des migrations:', err.message);
  process.exit(1);
});
