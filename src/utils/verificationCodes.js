const crypto = require('crypto');
const { pool, withTransaction } = require('../config/database');
const { isEmailConfigured, sendVerificationEmail } = require('./email');

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function generateCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

function hashCode(challengeId, userId, purpose, code) {
  const secret = process.env.OTP_SECRET || process.env.JWT_SECRET || process.env.SECRET;
  if (!secret) throw new Error('OTP_SECRET ou JWT_SECRET doit être configuré.');
  return crypto.createHmac('sha256', secret)
    .update(`${challengeId}:${userId}:${purpose}:${code}`)
    .digest('hex');
}

function codesEqual(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function maskEmail(email) {
  const [name, domain] = email.split('@');
  if (!domain) return 'votre adresse e-mail';
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(2, name.length - 1))}@${domain}`;
}

async function issueVerificationCode({ userId, email, purpose, ipAddress }) {
  if (!isEmailConfigured()) {
    const error = new Error('L’envoi des codes e-mail n’est pas configuré.');
    error.statusCode = 503;
    throw error;
  }

  await pool.query(
    `DELETE FROM auth_verification_codes
     WHERE expires_at < now() - interval '1 day'`
  );

  const challengeId = crypto.randomUUID();
  const code = generateCode();
  const codeHash = hashCode(challengeId, userId, purpose, code);

  await withTransaction(async client => {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
      [String(userId), purpose]
    );
    const { rows: recentCodes } = await client.query(
      `SELECT 1 FROM auth_verification_codes
       WHERE user_id = $1 AND purpose = $2
         AND created_at > now() - interval '60 seconds'
       LIMIT 1`,
      [userId, purpose]
    );
    if (recentCodes.length) {
      const error = new Error('Un code vient déjà d’être envoyé. Réessayez dans une minute.');
      error.statusCode = 429;
      throw error;
    }

    await client.query(
      `INSERT INTO auth_verification_codes
         (challenge_id, user_id, purpose, code_hash, expires_at, ip_adresse)
       VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 minute'), $6)`,
      [challengeId, userId, purpose, codeHash, CODE_TTL_MINUTES, ipAddress || null]
    );
  });

  try {
    await sendVerificationEmail(email, code, purpose);
  } catch (error) {
    await pool.query(
      'UPDATE auth_verification_codes SET consumed_at = now() WHERE challenge_id = $1',
      [challengeId]
    );
    const unavailable = new Error('Le service d’envoi des codes e-mail est indisponible.', { cause: error });
    unavailable.statusCode = 503;
    throw unavailable;
  }

  return { challenge_id: challengeId, email_masque: maskEmail(email) };
}

async function consumeVerificationCode(db, { challengeId, userId, purpose, code }) {
  if (!/^\d{6}$/.test(code || '')) return false;

  const { rows } = await db.query(
    `SELECT id, code_hash, attempts
     FROM auth_verification_codes
     WHERE challenge_id = $1 AND user_id = $2 AND purpose = $3
       AND consumed_at IS NULL AND expires_at > now()
     FOR UPDATE`,
    [challengeId, userId, purpose]
  );
  const record = rows[0];
  if (!record || record.attempts >= MAX_ATTEMPTS) return false;

  await db.query(
    'UPDATE auth_verification_codes SET attempts = attempts + 1 WHERE id = $1',
    [record.id]
  );
  const suppliedHash = hashCode(challengeId, userId, purpose, code);
  if (!codesEqual(record.code_hash, suppliedHash)) return false;

  await db.query(
    'UPDATE auth_verification_codes SET consumed_at = now() WHERE id = $1',
    [record.id]
  );
  return true;
}

module.exports = {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  generateCode,
  hashCode,
  maskEmail,
  issueVerificationCode,
  consumeVerificationCode
};
