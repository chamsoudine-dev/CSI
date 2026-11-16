/**
 * Remplace tous les comptes utilisateurs par l'administrateur et le superviseur nationaux.
 * Usage: npm run reset:logins -- --confirm
 */

const bcrypt = require('bcrypt');
const { Pool } = require('pg');

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Variable obligatoire manquante: ${name}`);
  return value;
}

function account({ emailVariable, passwordVariable, nameVariable, defaultName }) {
  const email = required(emailVariable).toLowerCase();
  const password = required(passwordVariable);
  const name = process.env[nameVariable]?.trim() || defaultName;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Adresse e-mail invalide: ${emailVariable}`);
  }
  if (password.length < 8) {
    throw new Error(`${passwordVariable} doit comporter au moins 8 caractères`);
  }
  if (name.length < 2) {
    throw new Error(`${nameVariable} doit comporter au moins 2 caractères`);
  }

  return { email, password, name };
}

async function resetLogins() {
  if (!process.argv.includes('--confirm')) {
    throw new Error('Opération annulée: relancez avec --confirm pour supprimer tous les comptes.');
  }
  if (process.env.SEED_DEMO === 'true') {
    throw new Error('Désactivez SEED_DEMO avant la réinitialisation pour éviter de recréer des comptes de démonstration.');
  }

  const admin = account({
    emailVariable: 'ADMIN_EMAIL',
    passwordVariable: 'ADMIN_PASSWORD',
    nameVariable: 'ADMIN_NOM',
    defaultName: 'Administrateur National'
  });
  const supervisor = account({
    emailVariable: 'SUPERVISEUR_NATIONAL_EMAIL',
    passwordVariable: 'SUPERVISEUR_NATIONAL_PASSWORD',
    nameVariable: 'SUPERVISEUR_NATIONAL_NOM',
    defaultName: 'Superviseur National'
  });

  if (admin.email === supervisor.email) {
    throw new Error('Les deux comptes doivent avoir des adresses e-mail différentes.');
  }

  const databaseUrl = required('DATABASE_URL');
  const [adminHash, supervisorHash] = await Promise.all([
    bcrypt.hash(admin.password, 12),
    bcrypt.hash(supervisor.password, 12)
  ]);
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE utilisateurs IN ACCESS EXCLUSIVE MODE');
    const deleted = await client.query('DELETE FROM utilisateurs');

    await client.query(
      `INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, actif)
       VALUES ($1, $2, $3, 'admin', TRUE), ($4, $5, $6, 'superviseur_national', TRUE)`,
      [admin.email, admin.name, adminHash, supervisor.email, supervisor.name, supervisorHash]
    );

    await client.query('COMMIT');
    console.log(`Réinitialisation terminée: ${deleted.rowCount} ancien(s) compte(s) supprimé(s).`);
    console.log(`Administrateur national: ${admin.email}`);
    console.log(`Superviseur national: ${supervisor.email}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

resetLogins().catch(error => {
  console.error(`Échec de la réinitialisation: ${error.message}`);
  process.exitCode = 1;
});