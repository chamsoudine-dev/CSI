const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CODE_TTL_MINUTES,
  MAX_ATTEMPTS,
  generateCode,
  hashCode,
  maskEmail
} = require('../src/utils/verificationCodes');

test('Codes de vérification - génération et durée de validité', () => {
  assert.equal(CODE_TTL_MINUTES, 10);
  assert.equal(MAX_ATTEMPTS, 5);
  assert.match(generateCode(), /^\d{6}$/);
});

test('Codes de vérification - liaison cryptographique au compte, usage et challenge', () => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-hmac';
  const hash = hashCode('challenge-a', 4, 'login_mfa', '123456');
  assert.equal(hash, hashCode('challenge-a', 4, 'login_mfa', '123456'));
  assert.notEqual(hash, hashCode('challenge-b', 4, 'login_mfa', '123456'));
  assert.notEqual(hash, hashCode('challenge-a', 5, 'login_mfa', '123456'));
  assert.notEqual(hash, hashCode('challenge-a', 4, 'password_reset', '123456'));
  assert.notEqual(hash, hashCode('challenge-a', 4, 'login_mfa', '123457'));
});

test('Codes de vérification - accepte un code juste une fois et limite les essais', async () => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-hmac';
  const challengeId = 'challenge-a';
  const userId = 4;
  const purpose = 'login_mfa';
  const record = {
    id: 12,
    code_hash: hashCode(challengeId, userId, purpose, '123456'),
    attempts: 0,
    consumed: false
  };
  const fakeDb = {
    async query(sql) {
      if (sql.includes('SELECT id, code_hash, attempts')) {
        return { rows: record.consumed ? [] : [{ ...record }] };
      }
      if (sql.includes('SET attempts = attempts + 1')) {
        record.attempts++;
        return { rows: [] };
      }
      if (sql.includes('SET consumed_at = now()')) {
        record.consumed = true;
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in verification test: ${sql}`);
    }
  };
  const { consumeVerificationCode } = require('../src/utils/verificationCodes');

  assert.equal(await consumeVerificationCode(fakeDb, {
    challengeId, userId, purpose, code: '000000'
  }), false);
  assert.equal(record.attempts, 1);
  assert.equal(await consumeVerificationCode(fakeDb, {
    challengeId, userId, purpose, code: '123456'
  }), true);
  assert.equal(record.consumed, true);
  assert.equal(await consumeVerificationCode(fakeDb, {
    challengeId, userId, purpose, code: '123456'
  }), false);
});

test('Codes de vérification - masquage de l’adresse e-mail', () => {
  assert.equal(maskEmail('amina@example.ne'), 'a****@example.ne');
});
