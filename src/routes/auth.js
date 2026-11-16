const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const router = express.Router();
const { pool, withTransaction } = require('../config/database');
const { auth, signToken, clearUserCache } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { validateIdParam } = require('../middleware/scope');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/audit');
const {
  issueVerificationCode,
  consumeVerificationCode
} = require('../utils/verificationCodes');
const { isEmailConfigured } = require('../utils/email');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path, user: req.user?.id }, 'Erreur route auth');
  res.status(e.statusCode || 500).json({ erreur: e.statusCode ? e.message : 'Erreur serveur' });
});

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    nom: user.nom,
    role: user.role,
    csi_id: user.csi_id,
    region_id: user.region_id,
    telephone: user.telephone,
    whatsapp: user.whatsapp,
    poste: user.poste,
    canal_2fa: user.canal_2fa || 'email',
    statut_2fa: Boolean(user.statut_2fa)
  };
}

function invalidCode(res) {
  return res.status(400).json({ erreur: 'Code invalide, expiré ou déjà utilisé.' });
}

// ── Vue HTMX : Formulaire de connexion ───────────────────────────────────────
router.get('/login-view', (req, res) => {
  const html = `
    <div class="auth-view">
      <div class="auth-card" style="max-width:480px">
        <div class="auth-card-header">
          <img src="/img/logo.png" alt="Logo MS/HP Niger" class="auth-card-logo">
          <h1 style="font-size:1.35rem;font-weight:800">CSI NIGER</h1>
          <p style="font-size:0.82rem;color:var(--text-muted);margin:0">Portail National de Surveillance</p>
        </div>

        <div id="login-err" class="hid" style="margin-top:14px"></div>

        <form id="login-form" style="margin-top:18px">
          <div style="display:flex;flex-direction:column;gap:12px">
            <label class="field">
              <span>Adresse e-mail</span>
              <input type="email" id="pw-email" autocomplete="username" placeholder="nom@exemple.ne" required>
            </label>
            <label class="field" id="password-field">
              <span>Mot de passe</span>
              <div class="password-input-wrap">
                <input type="password" id="pw-pass" autocomplete="current-password" data-password-input required>
                <button type="button" class="password-toggle" data-password-toggle="pw-pass" aria-label="Afficher le mot de passe" aria-pressed="false">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
              </div>
            </label>
            <label class="field hid" id="login-code-field">
              <span>Code de vérification reçu par e-mail</span>
              <input type="text" id="login-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code">
            </label>
          </div>

          <div style="margin-top:14px">
            <button class="btn btn-primary btn-lg" type="submit" id="login-btn" style="width:100%;justify-content:center;font-weight:700">
              Se connecter
            </button>
          </div>
        </form>

        <div style="margin-top:12px;text-align:center">
          <button type="button" class="btn btn-ghost btn-sm" id="forgot-link">Mot de passe oublié ?</button>
        </div>

        <div class="auth-security-notice" style="margin-top:16px">
          🔒 Connexion protégée par mot de passe. La vérification à deux étapes peut être activée dans votre profil.
        </div>
      </div>
    </div>
  `;
  res.send(html);
});

// ─── POST /api/login ── Mot de passe puis code e-mail si 2FA activée ─────────
router.post('/login', validate(schemas.loginSchema), wrap(async (req, res) => {
  const { email, mot_de_passe } = req.body;
  const { rows } = await pool.query(
    'SELECT * FROM utilisateurs WHERE email = $1 AND actif = TRUE',
    [email]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(mot_de_passe, user.mot_de_passe_hash))) {
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
  }

  if (user.statut_2fa) {
    const challenge = await issueVerificationCode({
      userId: user.id,
      email: user.email,
      purpose: 'login_mfa',
      ipAddress: req.ip
    });
    return res.status(202).json({
      verification_requise: true,
      ...challenge,
      message: `Un code de connexion a été envoyé à ${challenge.email_masque}.`
    });
  }

  await pool.query('UPDATE utilisateurs SET derniere_connexion = now() WHERE id = $1', [user.id]);
  res.json({ token: signToken(user), utilisateur: publicUser(user) });
}));

router.post('/login/verify-code', validate(schemas.verificationCodeSchema), wrap(async (req, res) => {
  const userId = await withTransaction(async client => {
    const { rows } = await client.query(
      'SELECT user_id FROM auth_verification_codes WHERE challenge_id = $1 FOR UPDATE',
      [req.body.challenge_id]
    );
    if (!rows[0]) return null;
    const valid = await consumeVerificationCode(client, {
      ...req.body,
      userId: rows[0].user_id,
      purpose: 'login_mfa'
    });
    return valid ? rows[0].user_id : null;
  });
  if (!userId) return invalidCode(res);

  const { rows } = await pool.query(
    'SELECT * FROM utilisateurs WHERE id = $1 AND actif = TRUE AND statut_2fa = TRUE',
    [userId]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ erreur: 'Compte indisponible. Recommencez la connexion.' });

  await pool.query('UPDATE utilisateurs SET derniere_connexion = now() WHERE id = $1', [user.id]);
  res.json({ token: signToken(user), utilisateur: publicUser(user) });
}));

// ─── GET /api/me ─────────────────────────────────────────────────────────────
router.get('/me', auth(), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.nom, u.role, u.csi_id, u.region_id,
            u.telephone, u.whatsapp, u.poste, u.canal_2fa, u.statut_2fa,
            u.derniere_connexion, u.cree_le,
            c.nom AS csi_nom, g.nom AS region_nom
     FROM utilisateurs u
     LEFT JOIN csi c ON c.id = u.csi_id
     LEFT JOIN regions g ON g.id = u.region_id
     WHERE u.id = $1 AND u.actif = TRUE`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });
  res.json(rows[0]);
}));

// ─── PUT /api/me/profil (Mise à jour des informations personnelles) ──────────
router.put('/me/profil', auth(), validate(schemas.profilSchema), wrap(async (req, res) => {
  const { nom, telephone, whatsapp, poste } = req.body;
  const updates = [];
  const params = [];
  let idx = 1;

  if (nom && nom.trim().length >= 2) {
    updates.push(`nom = $${idx++}`);
    params.push(nom.trim());
  }
  if (telephone !== undefined) {
    updates.push(`telephone = $${idx++}`);
    params.push(telephone ? telephone.trim() : null);
  }
  if (whatsapp !== undefined) {
    updates.push(`whatsapp = $${idx++}`);
    params.push(whatsapp ? whatsapp.trim() : null);
  }
  if (poste !== undefined) {
    updates.push(`poste = $${idx++}`);
    params.push(poste ? poste.trim() : null);
  }
  if (updates.length === 0) {
    return res.status(400).json({ erreur: 'Aucune donnée valide à mettre à jour' });
  }

  updates.push(`modifie_le = now()`);
  params.push(req.user.id);

  const sql = `UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = $${idx} RETURNING id, email, nom, role, csi_id, region_id, telephone, whatsapp, poste, canal_2fa, statut_2fa`;
  const { rows } = await pool.query(sql, params);
  clearUserCache(req.user.id);

  await logAudit({
    utilisateur_id: req.user.id,
    action: 'UPDATE_PROFIL',
    table_cible: 'utilisateurs',
    enregistrement_id: req.user.id,
    ip_adresse: req.ip
  });

  res.json({ message: 'Profil mis à jour avec succès', utilisateur: rows[0] });
}));

// ─── POST /api/me/mot-de-passe/demander-code ─────────────────────────────────
router.post('/me/mot-de-passe/demander-code', auth(), validate(schemas.demandeChangementMotDePasseSchema), wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, mot_de_passe_hash FROM utilisateurs WHERE id = $1 AND actif = TRUE',
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });

  const ok = await bcrypt.compare(req.body.ancien_mot_de_passe, rows[0].mot_de_passe_hash);
  if (!ok) {
    return res.status(400).json({ erreur: 'Ancien mot de passe incorrect' });
  }

  const challenge = await issueVerificationCode({
    userId: req.user.id,
    email: rows[0].email,
    purpose: 'password_change',
    ipAddress: req.ip
  });
  res.status(202).json({ ...challenge, message: `Un code a été envoyé à ${challenge.email_masque}.` });
}));

router.post('/me/mot-de-passe/valider', auth(), validate(schemas.changementMotDePasseSchema), wrap(async (req, res) => {
  const newPasswordHash = await bcrypt.hash(req.body.nouveau_mot_de_passe, 12);
  const changed = await withTransaction(async client => {
    const valid = await consumeVerificationCode(client, {
      ...req.body,
      userId: req.user.id,
      purpose: 'password_change'
    });
    if (!valid) return false;
    await client.query(
      `UPDATE utilisateurs
       SET mot_de_passe_hash = $1, session_version = session_version + 1
       WHERE id = $2`,
      [newPasswordHash, req.user.id]
    );
    return true;
  });
  if (!changed) return invalidCode(res);
  clearUserCache(req.user.id);

  await logAudit({
    utilisateur_id: req.user.id,
    action: 'CHANGE_PASSWORD',
    table_cible: 'utilisateurs',
    enregistrement_id: req.user.id,
    ip_adresse: req.ip
  });

  res.json({ message: 'Mot de passe modifié. Reconnectez-vous avec votre nouveau mot de passe.' });
}));

router.post('/mot-de-passe-oublie', validate(schemas.demandeReinitialisationSchema), wrap(async (req, res) => {
  if (!isEmailConfigured()) {
    return res.status(503).json({ erreur: 'La récupération n’est pas disponible : l’envoi e-mail du serveur doit être configuré.' });
  }
  const { rows } = await pool.query(
    'SELECT id, email FROM utilisateurs WHERE email = $1 AND actif = TRUE',
    [req.body.email]
  );
  let challengeId = crypto.randomUUID();
  if (rows[0]) {
    try {
      const challenge = await issueVerificationCode({
        userId: rows[0].id,
        email: rows[0].email,
        purpose: 'password_reset',
        ipAddress: req.ip
      });
      challengeId = challenge.challenge_id;
    } catch (error) {
      if (error.statusCode !== 429) {
        logger.error({ err: error, userId: rows[0].id }, 'Échec envoi code récupération');
      }
    }
  }
  res.status(202).json({
    challenge_id: challengeId,
    message: 'Si un compte actif correspond à cette adresse, un code de récupération vient d’être envoyé.'
  });
}));

router.post('/mot-de-passe-oublie/valider', validate(schemas.changementMotDePasseSchema), wrap(async (req, res) => {
  const newPasswordHash = await bcrypt.hash(req.body.nouveau_mot_de_passe, 12);
  const userId = await withTransaction(async client => {
    const { rows } = await client.query(
      `SELECT user_id FROM auth_verification_codes
       WHERE challenge_id = $1 AND purpose = 'password_reset'
       FOR UPDATE`,
      [req.body.challenge_id]
    );
    if (!rows[0]) return null;
    const valid = await consumeVerificationCode(client, {
      ...req.body,
      userId: rows[0].user_id,
      purpose: 'password_reset'
    });
    if (!valid) return null;
    const { rows: updated } = await client.query(
      `UPDATE utilisateurs
       SET mot_de_passe_hash = $1, session_version = session_version + 1
       WHERE id = $2 AND actif = TRUE`,
      [newPasswordHash, rows[0].user_id]
    );
    return updated[0]?.id || null;
  });
  if (!userId) return invalidCode(res);
  clearUserCache(userId);
  await logAudit({
    utilisateur_id: userId,
    action: 'RESET_PASSWORD',
    table_cible: 'utilisateurs',
    enregistrement_id: userId,
    ip_adresse: req.ip
  });
  res.json({ message: 'Mot de passe réinitialisé. Vous pouvez maintenant vous connecter.' });
}));

router.post('/me/2fa/demander-code', auth(), wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT email FROM utilisateurs WHERE id = $1 AND actif = TRUE',
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });
  const purpose = req.user.statut_2fa ? 'mfa_disable' : 'mfa_setup';
  const challenge = await issueVerificationCode({
    userId: req.user.id,
    email: rows[0].email,
    purpose,
    ipAddress: req.ip
  });
  res.status(202).json({
    ...challenge,
    message: `Un code de vérification a été envoyé à ${challenge.email_masque}.`
  });
}));

router.post('/me/2fa/verifier-code', auth(), validate(schemas.verificationCodeSchema), wrap(async (req, res) => {
  const purpose = req.user.statut_2fa ? 'mfa_disable' : 'mfa_setup';
  const enabled = !req.user.statut_2fa;
  const changed = await withTransaction(async client => {
    const valid = await consumeVerificationCode(client, {
      ...req.body,
      userId: req.user.id,
      purpose
    });
    if (!valid) return false;
    await client.query(
      'UPDATE utilisateurs SET statut_2fa = $1, canal_2fa = $2, session_version = session_version + 1 WHERE id = $3',
      [enabled, 'email', req.user.id]
    );
    return true;
  });
  if (!changed) return invalidCode(res);
  clearUserCache(req.user.id);
  await logAudit({
    utilisateur_id: req.user.id,
    action: enabled ? 'ENABLE_2FA' : 'DISABLE_2FA',
    table_cible: 'utilisateurs',
    enregistrement_id: req.user.id,
    ip_adresse: req.ip
  });
  res.json({ message: enabled ? 'La double authentification par e-mail est activée.' : 'La double authentification est désactivée.' });
}));

// ─── GET /api/utilisateurs ── Admin et superviseur ───────────────────────────
router.get('/utilisateurs', auth(['admin', 'superviseur', 'superviseur_national']), wrap(async (req, res) => {
  const { role, region_id } = req.user;
  let query = `SELECT u.id, u.email, u.nom, u.role, u.actif, u.csi_id, u.region_id, u.cree_par,
                      u.derniere_connexion, u.cree_le, c.nom AS csi_nom, g.nom AS region_nom,
                      createur.nom AS cree_par_nom
               FROM utilisateurs u
               LEFT JOIN csi c ON c.id = u.csi_id
               LEFT JOIN regions g ON g.id = u.region_id
               LEFT JOIN utilisateurs createur ON createur.id = u.cree_par`;
  const params = [];

  // Superviseur voit uniquement les agents de sa région
  if (role === 'superviseur' && region_id) {
    query += ` WHERE (u.role = 'agent' AND (u.region_id = $1 OR (u.csi_id IN (SELECT c.id FROM csi c JOIN communes co ON co.id = c.commune_id WHERE co.region_id = $1))))`;
    params.push(region_id);
  } else if (role === 'superviseur_national') {
    query += ` WHERE u.role IN ('agent', 'superviseur')`;
  }

  query += ' ORDER BY u.role, u.nom';
  const { rows } = await pool.query(query, params);
  res.json(rows);
}));

// ─── POST /api/utilisateurs ── Admin et superviseur (Phase 2.8) ───────────────
router.post('/utilisateurs', auth(['admin', 'superviseur', 'superviseur_national']), validate(schemas.utilisateurSchema), wrap(async (req, res) => {
  const { email, nom, mot_de_passe, role, csi_id, region_id } = req.body;

  if (!mot_de_passe) return res.status(400).json({ erreur: 'Mot de passe requis pour créer un utilisateur' });
  if (mot_de_passe.length < 8) return res.status(400).json({ erreur: 'Mot de passe trop court (minimum 8 caractères)' });

  // Contrôle d'accès superviseur (agents de sa région uniquement)
  if (req.user.role === 'superviseur') {
    if (role !== 'agent') {
      return res.status(403).json({ erreur: 'Un superviseur ne peut créer que des comptes ayant le rôle agent' });
    }
    if (!csi_id) {
      return res.status(400).json({ erreur: 'Un CSI est obligatoire pour créer un compte agent' });
    }
    // Vérifier que le CSI appartient bien à la région du superviseur
    const { rows: csiCheck } = await pool.query(
      `SELECT 1 FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1 AND co.region_id = $2`,
      [csi_id, req.user.region_id]
    );
    if (!csiCheck[0]) {
      return res.status(403).json({ erreur: 'Le CSI spécifié n\'appartient pas à votre région' });
    }
  }

  let userRegionId = req.user.role === 'superviseur' ? req.user.region_id : (region_id || null);
  if (req.user.role === 'superviseur_national') {
    if (!['agent', 'superviseur'].includes(role)) {
      return res.status(403).json({ erreur: 'Un superviseur national ne peut créer que des comptes agents ou superviseurs régionaux' });
    }
    if (role === 'agent') {
      if (!csi_id) return res.status(400).json({ erreur: 'Un CSI est obligatoire pour créer un compte agent' });
      const { rows: csiRows } = await pool.query(
        `SELECT co.region_id FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1 AND c.actif`,
        [csi_id]
      );
      if (!csiRows[0]) return res.status(400).json({ erreur: 'Le CSI spécifié est introuvable ou inactif' });
      userRegionId = csiRows[0].region_id;
    } else {
      if (!region_id) return res.status(400).json({ erreur: 'Une région est obligatoire pour créer un superviseur régional' });
      const { rows: regionRows } = await pool.query('SELECT 1 FROM regions WHERE id = $1', [region_id]);
      if (!regionRows[0]) return res.status(400).json({ erreur: 'La région spécifiée est introuvable' });
    }
  }

  const hash = await bcrypt.hash(mot_de_passe, 12);

  try {
    const { rows } = await pool.query(
      `INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, csi_id, region_id, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, nom, role, csi_id, region_id, cree_par, actif, cree_le`,
      [email.toLowerCase().trim(), nom.trim(), hash, role, csi_id || null, userRegionId, req.user.id]
    );
    logger.info({ creatorId: req.user.id, newUserId: rows[0].id }, 'Nouvel utilisateur créé');
    await logAudit({
      utilisateur_id: req.user.id,
      action: 'CREATE_USER',
      table_cible: 'utilisateurs',
      enregistrement_id: rows[0].id,
      details: { email: rows[0].email, role: rows[0].role, cree_par: req.user.id },
      ip_adresse: req.ip
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erreur: 'Cet email est déjà utilisé' });
    throw e;
  }
}));

// ─── PUT /api/utilisateurs/:id ── Admin ou Superviseur (Phase 2.8 & 2.9) ─────
router.put('/utilisateurs/:id', auth(['admin', 'superviseur', 'superviseur_national']), validateIdParam('id'), validate(schemas.utilisateurUpdateSchema), wrap(async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { email, nom, mot_de_passe, role, csi_id, region_id, actif } = req.body;

  const { rows: existingRows } = await pool.query('SELECT * FROM utilisateurs WHERE id = $1', [targetId]);
  if (!existingRows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });
  const targetUser = existingRows[0];

  if (req.user.role === 'superviseur_national' &&
      (targetUser.role === 'admin' || (targetUser.role === 'superviseur_national' && targetId !== req.user.id))) {
    return res.status(403).json({ erreur: 'Un superviseur national ne peut pas modifier ce compte' });
  }
  if (req.user.role === 'superviseur_national' && targetUser.role === 'superviseur_national' && role !== undefined) {
    return res.status(400).json({ erreur: 'Vous ne pouvez pas modifier votre propre rôle' });
  }

  // Règle 2.8 : Superviseur ne gère que les agents de sa région
  if (req.user.role === 'superviseur') {
    if (targetUser.role !== 'agent') {
      return res.status(403).json({ erreur: 'Vous ne pouvez modifier que les comptes agents' });
    }
    // Vérifier que le CSI actuel de l'agent appartient à la région du superviseur
    if (targetUser.csi_id) {
      const { rows: csiCheck } = await pool.query(
        `SELECT 1 FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1 AND co.region_id = $2`,
        [targetUser.csi_id, req.user.region_id]
      );
      if (!csiCheck[0]) {
        return res.status(403).json({ erreur: 'Cet agent n\'appartient pas à votre région' });
      }
    }
    // Le superviseur ne peut pas changer le rôle vers autre chose qu'agent
    if (role && role !== 'agent') {
      return res.status(403).json({ erreur: 'Un superviseur ne peut pas modifier le rôle d\'un utilisateur' });
    }
    // Si csi_id modifié, vérifier qu'il reste dans sa région
    if (csi_id) {
      const { rows: newCsiCheck } = await pool.query(
        `SELECT 1 FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1 AND co.region_id = $2`,
        [csi_id, req.user.region_id]
      );
      if (!newCsiCheck[0]) {
        return res.status(403).json({ erreur: 'Le nouveau CSI doit appartenir à votre région' });
      }
    }
  }

  let nationalAgentRegionId = null;
  if (req.user.role === 'superviseur_national') {
    if (role === 'admin' || role === 'superviseur_national') {
      return res.status(403).json({ erreur: 'Un superviseur national ne peut pas attribuer un rôle administrateur ou superviseur national' });
    }
    if (role === 'superviseur' && !region_id && targetUser.role !== 'superviseur') {
      return res.status(400).json({ erreur: 'Une région est obligatoire pour un superviseur régional' });
    }
    if ((role || targetUser.role) === 'superviseur' && region_id !== undefined) {
      if (!region_id) return res.status(400).json({ erreur: 'Une région est obligatoire pour un superviseur régional' });
      const { rows: regionRows } = await pool.query('SELECT 1 FROM regions WHERE id = $1', [region_id]);
      if (!regionRows[0]) return res.status(400).json({ erreur: 'La région spécifiée est introuvable' });
    }
    if ((role || targetUser.role) === 'agent') {
      const assignedCsiId = csi_id !== undefined ? csi_id : targetUser.csi_id;
      if (!assignedCsiId) return res.status(400).json({ erreur: 'Un CSI est obligatoire pour un compte agent' });
      const { rows: csiRows } = await pool.query(
        `SELECT co.region_id FROM csi c
         JOIN communes co ON co.id = c.commune_id
         WHERE c.id = $1 AND c.actif`,
        [assignedCsiId]
      );
      if (!csiRows[0]) return res.status(400).json({ erreur: 'Le CSI spécifié est introuvable ou inactif' });
      nationalAgentRegionId = csiRows[0].region_id;
    }
  }

  // Règle 2.8 Admin :
  // - Tout admin peut gérer tous les comptes (règle créateur retirée).
  // - Ne peut pas se désactiver lui-même
  if (targetId === req.user.id && actif === false) {
    return res.status(400).json({ erreur: 'Vous ne pouvez pas désactiver votre propre compte' });
  }

  // - Ne peut pas désactiver le dernier admin actif
  if (targetUser.role === 'admin' && actif === false) {
    const { rows: adminCount } = await pool.query(
      `SELECT count(*) FROM utilisateurs WHERE role = 'admin' AND actif = TRUE AND id != $1`,
      [targetId]
    );
    if (parseInt(adminCount[0].count, 10) === 0) {
      return res.status(400).json({ erreur: 'Impossible de désactiver le dernier administrateur actif du système' });
    }
  }

  const updates = [];
  const params = [];
  let i = 1;

  if (email !== undefined) {
    const cleanEmail = email.toLowerCase().trim();
    const { rows: emailCheck } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1 AND id != $2', [cleanEmail, targetId]);
    if (emailCheck[0]) return res.status(409).json({ erreur: 'Cet email est déjà utilisé par un autre compte' });
    updates.push(`email = $${i++}`);
    params.push(cleanEmail);
  }

  if (nom !== undefined)       { updates.push(`nom = $${i++}`);       params.push(nom.trim()); }
  if (role !== undefined && (req.user.role === 'admin' || req.user.role === 'superviseur_national')) { updates.push(`role = $${i++}`); params.push(role); }
  if (csi_id !== undefined)    { updates.push(`csi_id = $${i++}`);    params.push(csi_id || null); }
  if (region_id !== undefined && (req.user.role === 'admin' || req.user.role === 'superviseur_national')) { updates.push(`region_id = $${i++}`); params.push(region_id || null); }
  if (req.user.role === 'superviseur_national' && nationalAgentRegionId !== null) {
    updates.push(`region_id = $${i++}`);
    params.push(nationalAgentRegionId);
  } else if (req.user.role === 'superviseur_national' && role === 'superviseur') {
    updates.push(`csi_id = NULL`);
  }
  if (actif !== undefined)     { updates.push(`actif = $${i++}`);     params.push(actif); }

  if (mot_de_passe) {
    if (mot_de_passe.length < 8) return res.status(400).json({ erreur: 'Mot de passe trop court (minimum 8 caractères)' });
    const hash = await bcrypt.hash(mot_de_passe, 12);
    updates.push(`mot_de_passe_hash = $${i++}`);
    params.push(hash);
  }

  if (updates.length === 0) return res.status(400).json({ erreur: 'Aucune modification fournie' });

  params.push(targetId);
  const { rows } = await pool.query(
    `UPDATE utilisateurs SET ${updates.join(', ')}, session_version = session_version + 1
     WHERE id = $${i}
     RETURNING id, email, nom, role, actif, csi_id, region_id, cree_par`,
    params
  );

  clearUserCache(targetId);

  logger.info({ operatorId: req.user.id, targetId }, 'Utilisateur modifié');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'UPDATE_USER',
    table_cible: 'utilisateurs',
    enregistrement_id: targetId,
    details: { champs: Object.keys(req.body).filter(k => k !== 'mot_de_passe') },
    ip_adresse: req.ip
  });
  res.json(rows[0]);
}));

// ─── DELETE /api/utilisateurs/:id ── Admin ou Superviseur (Phase 2.8 & 2.9) ──
router.delete('/utilisateurs/:id', auth(['admin', 'superviseur', 'superviseur_national']), validateIdParam('id'), wrap(async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === req.user.id) {
    return res.status(400).json({ erreur: 'Vous ne pouvez pas vous supprimer ou vous désactiver vous-même' });
  }

  const { rows: existingRows } = await pool.query('SELECT * FROM utilisateurs WHERE id = $1', [targetId]);
  if (!existingRows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });
  const targetUser = existingRows[0];

  if (req.user.role === 'superviseur_national' &&
      (targetUser.role === 'admin' || targetUser.role === 'superviseur_national')) {
    return res.status(403).json({ erreur: 'Un superviseur national ne peut pas supprimer un compte administrateur ou superviseur national' });
  }

  // Superviseur : agents de sa région uniquement (désactivation uniquement)
  if (req.user.role === 'superviseur') {
    if (targetUser.role !== 'agent') {
      return res.status(403).json({ erreur: 'Vous ne pouvez désactiver que les comptes agents' });
    }
    if (targetUser.csi_id) {
      const { rows: csiCheck } = await pool.query(
        `SELECT 1 FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1 AND co.region_id = $2`,
        [targetUser.csi_id, req.user.region_id]
      );
      if (!csiCheck[0]) {
        return res.status(403).json({ erreur: 'Cet agent n\'appartient pas à votre région' });
      }
    }
  }

  // Admin : ne pas supprimer ou désactiver le dernier admin actif
  if (targetUser.role === 'admin') {
    const { rows: adminCount } = await pool.query(
      `SELECT count(*) FROM utilisateurs WHERE role = 'admin' AND actif = TRUE AND id != $1`,
      [targetId]
    );
    if (parseInt(adminCount[0].count, 10) === 0) {
      return res.status(400).json({ erreur: 'Impossible de supprimer ou désactiver le dernier administrateur actif' });
    }
  }

  const permanent = req.query.permanent === 'true' && req.user.role === 'admin';

  if (permanent) {
    try {
      await pool.query('DELETE FROM utilisateurs WHERE id = $1', [targetId]);
      clearUserCache(targetId);
      logger.info({ adminId: req.user.id, targetId }, 'Utilisateur supprimé définitivement');
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'DELETE_USER_PERMANENT',
        table_cible: 'utilisateurs',
        enregistrement_id: targetId,
        details: { email: targetUser.email, nom: targetUser.nom },
        ip_adresse: req.ip
      });
      return res.json({ ok: true, message: 'Utilisateur supprimé avec succès', id: targetId });
    } catch (err) {
      logger.warn({ err, targetId }, 'Suppression physique impossible, désactivation à la place');
    }
  }

  const { rows } = await pool.query(
    'UPDATE utilisateurs SET actif = FALSE, session_version = session_version + 1 WHERE id = $1 RETURNING id, email, nom, role, actif, cree_par',
    [targetId]
  );

  clearUserCache(targetId);

  logger.info({ operatorId: req.user.id, targetId }, 'Utilisateur désactivé');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'DEACTIVATE_USER',
    table_cible: 'utilisateurs',
    enregistrement_id: targetId,
    details: { email: rows[0].email },
    ip_adresse: req.ip
  });
  res.json({ ok: true, utilisateur: rows[0] });
}));

module.exports = router;
