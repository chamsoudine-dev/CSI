const express = require('express');
const router = express.Router();
const { pool, withTransaction } = require('../config/database');
const { auth } = require('../middleware/auth');
const { validateIdParam } = require('../middleware/scope');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');

const FIELD_TYPES = new Set(['text', 'textarea', 'number', 'date', 'select', 'multiselect', 'checkbox']);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(error => {
  if (error.status) return res.status(error.status).json({ erreur: error.message });
  logger.error({ err: error, route: req.path, user: req.user?.id }, 'Erreur route missions');
  res.status(500).json({ erreur: 'Erreur serveur missions' });
});

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeFormulaire(value) {
  const fields = value?.fields;
  if (!Array.isArray(fields) || fields.length > 80) {
    throw httpError(400, 'Le formulaire doit contenir au maximum 80 questions.');
  }

  const ids = new Set();
  const normalized = fields.map((field, index) => {
    const label = String(field?.label || '').trim();
    const type = String(field?.type || 'text');
    const id = String(field?.id || `question_${index + 1}`).trim();
    if (!label || label.length > 240) throw httpError(400, `Libellé invalide pour la question ${index + 1}.`);
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(id) || ids.has(id)) throw httpError(400, 'Identifiants de questions invalides ou dupliqués.');
    if (!FIELD_TYPES.has(type)) throw httpError(400, `Type de question non pris en charge: ${type}.`);
    ids.add(id);

    const options = Array.isArray(field.options)
      ? [...new Set(field.options.map(option => String(option).trim()).filter(Boolean))].slice(0, 40)
      : [];
    if (['select', 'multiselect'].includes(type) && !options.length) {
      throw httpError(400, `Ajoutez au moins une option à « ${label} ».`);
    }
    return { id, label, type, required: Boolean(field.required), options };
  });

  return { fields: normalized };
}

function comparableForm(form) {
  return JSON.stringify((form?.fields || []).map(field => ({
    id: field.id,
    label: field.label,
    type: field.type,
    required: Boolean(field.required),
    options: field.options || []
  })));
}

function completionPercent(form, answers) {
  const fields = form?.fields || [];
  if (!fields.length) return 0;
  const completed = fields.filter(field => {
    const value = answers?.[field.id];
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';
  }).length;
  return Math.round(completed / fields.length * 100);
}

function normalizePeriod(start, end, published) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const isCalendarDate = value => {
    if (!datePattern.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (start && !isCalendarDate(start)) throw httpError(400, 'Date de début invalide.');
  if (end && !isCalendarDate(end)) throw httpError(400, 'Date limite invalide.');
  if (published && (!start || !end)) throw httpError(400, 'Définissez une date de début et une date de fin avant de publier.');
  if (start && end && start > end) throw httpError(400, 'La date de début doit précéder ou égaler la date de fin.');
  return { start: start || null, end: end || null };
}

function normalizeAgentIds(value) {
  if (!Array.isArray(value)) throw httpError(400, 'La liste des agents affectés est requise.');
  const ids = [...new Set(value.map(Number))];
  if (ids.some(id => !Number.isInteger(id) || id < 1)) throw httpError(400, 'Identifiant d’agent invalide.');
  return ids;
}

async function getActiveAgents(client, ids) {
  if (!ids.length) return [];
  const { rows } = await client.query(
    `SELECT id, csi_id FROM utilisateurs
     WHERE id = ANY($1) AND role = 'agent' AND actif = TRUE AND csi_id IS NOT NULL`,
    [ids]
  );
  if (rows.length !== ids.length) throw httpError(400, 'Un ou plusieurs agents sont inactifs ou sans CSI associé.');
  return rows;
}

function validateAnswers(form, rawAnswers, submitting) {
  if (!rawAnswers || typeof rawAnswers !== 'object' || Array.isArray(rawAnswers)) {
    return 'Les réponses doivent être un objet valide.';
  }
  const fields = form?.fields || [];
  const allowed = new Map(fields.map(field => [field.id, field]));
  if (Object.keys(rawAnswers).some(key => !allowed.has(key))) return 'Le formulaire a changé; rechargez la mission.';

  for (const field of fields) {
    const value = rawAnswers[field.id];
    const hasValue = Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';
    if (submitting && field.required && !hasValue) return `La question « ${field.label} » est obligatoire.`;
    if (!hasValue) continue;
    if (['text', 'textarea', 'date'].includes(field.type) && (typeof value !== 'string' || value.length > 10000)) {
      return `Réponse invalide pour « ${field.label} ».`;
    }
    if (field.type === 'number' && !Number.isFinite(Number(value))) return `Valeur numérique invalide pour « ${field.label} ».`;
    if (field.type === 'checkbox' && typeof value !== 'boolean') return `Réponse invalide pour « ${field.label} ».`;
    if (field.type === 'select' && !field.options.includes(value)) return `Option invalide pour « ${field.label} ».`;
    if (field.type === 'multiselect' && (!Array.isArray(value) || value.some(item => !field.options.includes(item)))) {
      return `Options invalides pour « ${field.label} ».`;
    }
  }
  return null;
}

router.get('/', auth(['admin', 'agent']), wrap(async (req, res) => {
  if (req.user.role === 'admin') {
    const { rows } = await pool.query(
      `SELECT m.*, creator.nom AS createur_nom,
              COALESCE(json_agg(json_build_object(
                'id', a.id, 'agent_id', a.agent_id, 'agent_nom', u.nom,
                'email', u.email, 'csi_id', a.csi_id, 'csi_nom', c.nom,
                'statut', a.statut, 'reponses', a.reponses,
                'acceptee_le', a.acceptee_le, 'soumise_le', a.soumise_le,
                'modifiee_le', a.modifiee_le
              ) ORDER BY u.nom) FILTER (WHERE a.id IS NOT NULL), '[]'::json) AS affectations
       FROM missions m
       LEFT JOIN utilisateurs creator ON creator.id = m.cree_par
       LEFT JOIN mission_affectations a ON a.mission_id = m.id
       LEFT JOIN utilisateurs u ON u.id = a.agent_id
       LEFT JOIN csi c ON c.id = a.csi_id
       GROUP BY m.id, creator.nom
       ORDER BY m.modifie_le DESC`
    );
    return res.json(rows.map(mission => ({
      ...mission,
      affectations: (mission.affectations || []).map(assignment => ({
        ...assignment,
        progression_pct: completionPercent(mission.formulaire, assignment.reponses)
      }))
    })));
  }

  const { rows } = await pool.query(
        `SELECT m.id, m.titre, m.description, m.formulaire, m.date_debut, m.date_limite, m.statut AS mission_statut,
          a.id AS affectation_id, a.statut, a.reponses, a.affectee_le, a.acceptee_le,
          a.soumise_le, a.modifiee_le,
          CASE WHEN m.date_debut IS NOT NULL AND CURRENT_DATE < m.date_debut THEN 'A_VENIR'
         WHEN m.date_limite IS NOT NULL AND CURRENT_DATE > m.date_limite THEN 'EXPIREE'
         ELSE 'ACTIVE' END AS periode_statut,
            c.id AS csi_id, c.nom AS csi_nom
     FROM mission_affectations a
     JOIN missions m ON m.id = a.mission_id
     JOIN csi c ON c.id = a.csi_id
     WHERE a.agent_id = $1 AND m.statut = 'PUBLIEE'
     ORDER BY m.date_limite NULLS LAST, m.titre`,
    [req.user.id]
  );
  res.json(rows.map(mission => ({
    ...mission,
    progression_pct: completionPercent(mission.formulaire, mission.reponses)
  })));
}));

router.post('/:id/accepter', auth(['agent']), validateIdParam('id'), wrap(async (req, res) => {
  const result = await withTransaction(async client => {
    const { rows } = await client.query(
      `SELECT a.id, a.statut, m.statut AS mission_statut,
              (m.date_debut IS NULL OR CURRENT_DATE >= m.date_debut) AS periode_commencee,
              (m.date_limite IS NULL OR CURRENT_DATE <= m.date_limite) AS periode_ouverte
       FROM mission_affectations a JOIN missions m ON m.id = a.mission_id
       WHERE a.mission_id = $1 AND a.agent_id = $2 FOR UPDATE OF a`,
      [req.params.id, req.user.id]
    );
    const assignment = rows[0];
    if (!assignment || assignment.mission_statut !== 'PUBLIEE') throw httpError(404, 'Mission non trouvée ou non affectée à ce compte.');
    if (assignment.statut !== 'AFFECTEE') throw httpError(409, 'Cette mission a déjà été acceptée ou terminée.');
    if (!assignment.periode_commencee) throw httpError(409, 'La période de cette mission n’a pas encore commencé.');
    if (!assignment.periode_ouverte) throw httpError(409, 'La période de cette mission est terminée.');

    await client.query(
      `UPDATE mission_affectations SET statut = 'ACCEPTEE', acceptee_le = now(), modifiee_le = now()
       WHERE id = $1`,
      [assignment.id]
    );
    return { statut: 'ACCEPTEE' };
  });
  await logAudit({ utilisateur_id: req.user.id, action: 'ACCEPTER_MISSION', table_cible: 'missions', enregistrement_id: Number(req.params.id), ip_adresse: req.ip });
  res.json({ ok: true, ...result });
}));

router.post('/generer-formulaire', auth(['admin']), wrap(async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (prompt.length < 10 || prompt.length > 5000) {
    return res.status(400).json({ erreur: 'Décrivez la mission en 10 à 5 000 caractères.' });
  }
  if (!process.env.AI_API_KEY) {
    return res.status(503).json({ erreur: 'La génération IA n’est pas configurée. Ajoutez AI_API_KEY au serveur.' });
  }

  const endpoint = process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'Tu conçois des formulaires de mission pour des agents de santé au Niger. Réponds uniquement en JSON sous la forme {"fields":[{"id":"...","label":"...","type":"text|textarea|number|date|select|multiselect|checkbox","required":true,"options":[]}]} . Crée des questions simples, neutres et utiles. Pour select et multiselect, fournis des options. N’inclus aucun nom de patient ni donnée personnelle.'
        },
        { role: 'user', content: prompt }
      ]
    }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) return res.status(502).json({ erreur: 'Le service IA n’a pas pu générer le formulaire.' });

  let generated;
  try {
    const payload = await response.json();
    generated = normalizeFormulaire(JSON.parse(payload.choices?.[0]?.message?.content || '{}'));
  } catch (error) {
    return res.status(502).json({ erreur: error.status ? error.message : 'La réponse IA n’est pas un formulaire exploitable.' });
  }
  if (!generated.fields.length) return res.status(502).json({ erreur: 'Le service IA a renvoyé un formulaire vide.' });
  res.json(generated);
}));

router.post('/', auth(['admin']), wrap(async (req, res) => {
  const titre = String(req.body?.titre || '').trim();
  const description = String(req.body?.description || '').trim();
  const statut = req.body?.statut === 'PUBLIEE' ? 'PUBLIEE' : 'BROUILLON';
  if (titre.length < 2 || titre.length > 160) return res.status(400).json({ erreur: 'Le titre doit contenir entre 2 et 160 caractères.' });
  if (description.length > 5000) return res.status(400).json({ erreur: 'La description est trop longue.' });

  let formulaire;
  let agentIds;
  try {
    formulaire = normalizeFormulaire(req.body.formulaire);
    agentIds = normalizeAgentIds(req.body.agent_ids);
  } catch (error) {
    return res.status(error.status || 400).json({ erreur: error.message });
  }
  if (statut === 'PUBLIEE' && (!formulaire.fields.length || !agentIds.length)) {
    return res.status(400).json({ erreur: 'Ajoutez au moins une question et un agent avant de publier.' });
  }

  const dateLimite = req.body.date_limite || null;
  let period;
  try { period = normalizePeriod(req.body.date_debut || null, dateLimite, statut === 'PUBLIEE'); }
  catch (error) { return res.status(error.status || 400).json({ erreur: error.message }); }

  const mission = await withTransaction(async client => {
    const agents = await getActiveAgents(client, agentIds);
    const { rows } = await client.query(
      `INSERT INTO missions (titre, description, formulaire, date_debut, date_limite, statut, cree_par)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7) RETURNING *`,
      [titre, description, JSON.stringify(formulaire), period.start, period.end, statut, req.user.id]
    );
    for (const agent of agents) {
      await client.query(
        'INSERT INTO mission_affectations (mission_id, agent_id, csi_id) VALUES ($1, $2, $3)',
        [rows[0].id, agent.id, agent.csi_id]
      );
    }
    return rows[0];
  });
  await logAudit({ utilisateur_id: req.user.id, action: 'CREATE_MISSION', table_cible: 'missions', enregistrement_id: mission.id, ip_adresse: req.ip });
  res.status(201).json(mission);
}));

router.put('/:id', auth(['admin']), validateIdParam('id'), wrap(async (req, res) => {
  const titre = String(req.body?.titre || '').trim();
  const description = String(req.body?.description || '').trim();
  const statut = ['BROUILLON', 'PUBLIEE', 'CLOTUREE'].includes(req.body?.statut) ? req.body.statut : null;
  if (titre.length < 2 || titre.length > 160 || description.length > 5000 || !statut) {
    return res.status(400).json({ erreur: 'Titre, description ou statut invalide.' });
  }

  let formulaire;
  let agentIds;
  try {
    formulaire = normalizeFormulaire(req.body.formulaire);
    agentIds = normalizeAgentIds(req.body.agent_ids);
  } catch (error) {
    return res.status(error.status || 400).json({ erreur: error.message });
  }
  if (statut === 'PUBLIEE' && (!formulaire.fields.length || !agentIds.length)) {
    return res.status(400).json({ erreur: 'Ajoutez au moins une question et un agent avant de publier.' });
  }
  const dateLimite = req.body.date_limite || null;
  let period;
  try { period = normalizePeriod(req.body.date_debut || null, dateLimite, statut === 'PUBLIEE'); }
  catch (error) { return res.status(error.status || 400).json({ erreur: error.message }); }

  const mission = await withTransaction(async client => {
    const { rows } = await client.query('SELECT * FROM missions WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) throw httpError(404, 'Mission introuvable.');
    const existing = (await client.query(
      'SELECT agent_id, statut, reponses FROM mission_affectations WHERE mission_id = $1 FOR UPDATE',
      [req.params.id]
    )).rows;
    const assignmentsChanged = existing.length !== agentIds.length || existing.some(item => !agentIds.includes(item.agent_id));
    const formChanged = comparableForm(rows[0].formulaire) !== comparableForm(formulaire);
    const workStarted = existing.some(item => item.statut !== 'AFFECTEE' || Object.keys(item.reponses || {}).length > 0);
    if (workStarted && (assignmentsChanged || formChanged)) {
      throw httpError(409, 'La mission a déjà commencé; les questions et les agents affectés ne peuvent plus être remplacés.');
    }

    const agents = await getActiveAgents(client, agentIds);
    const updated = await client.query(
      `UPDATE missions SET titre = $1, description = $2, formulaire = $3::jsonb,
                           date_debut = $4, date_limite = $5, statut = $6, modifie_le = now()
       WHERE id = $7 RETURNING *`,
      [titre, description, JSON.stringify(formulaire), period.start, period.end, statut, req.params.id]
    );
    if (assignmentsChanged) {
      await client.query('DELETE FROM mission_affectations WHERE mission_id = $1', [req.params.id]);
      for (const agent of agents) {
        await client.query(
          'INSERT INTO mission_affectations (mission_id, agent_id, csi_id) VALUES ($1, $2, $3)',
          [req.params.id, agent.id, agent.csi_id]
        );
      }
    }
    return updated.rows[0];
  });
  await logAudit({ utilisateur_id: req.user.id, action: 'UPDATE_MISSION', table_cible: 'missions', enregistrement_id: mission.id, ip_adresse: req.ip });
  res.json(mission);
}));

router.put('/:id/reponses', auth(['agent']), validateIdParam('id'), wrap(async (req, res) => {
  const submitting = req.body?.soumettre === true;
  const result = await withTransaction(async client => {
    const { rows } = await client.query(
            `SELECT a.id, a.statut, m.statut AS mission_statut, m.formulaire,
              (m.date_debut IS NULL OR CURRENT_DATE >= m.date_debut) AS periode_commencee,
              (m.date_limite IS NULL OR CURRENT_DATE <= m.date_limite) AS periode_ouverte
       FROM mission_affectations a JOIN missions m ON m.id = a.mission_id
       WHERE a.mission_id = $1 AND a.agent_id = $2 FOR UPDATE OF a`,
      [req.params.id, req.user.id]
    );
    const assignment = rows[0];
    if (!assignment || assignment.mission_statut !== 'PUBLIEE') throw httpError(404, 'Mission non trouvée ou non affectée à ce compte.');
    if (assignment.statut === 'SOUMISE' || assignment.mission_statut === 'CLOTUREE') throw httpError(409, 'Cette mission n’accepte plus de réponses.');
    if (assignment.statut === 'AFFECTEE') throw httpError(409, 'Acceptez d’abord la mission avant de commencer.');
    if (!assignment.periode_commencee) throw httpError(409, 'La période de cette mission n’a pas encore commencé.');
    if (!assignment.periode_ouverte) throw httpError(409, 'La période de cette mission est terminée.');

    const reponses = req.body?.reponses || {};
    const error = validateAnswers(assignment.formulaire, reponses, submitting);
    if (error) throw httpError(400, error);
    const status = submitting ? 'SOUMISE' : 'EN_COURS';
    await client.query(
      `UPDATE mission_affectations SET reponses = $1::jsonb, statut = $2, modifiee_le = now(),
        soumise_le = CASE WHEN $2 = 'SOUMISE' THEN now() ELSE NULL END
       WHERE id = $3`,
      [JSON.stringify(reponses), status, assignment.id]
    );
    return { statut: status };
  });
  await logAudit({ utilisateur_id: req.user.id, action: submitting ? 'SUBMIT_MISSION' : 'SAVE_MISSION', table_cible: 'missions', enregistrement_id: Number(req.params.id), ip_adresse: req.ip });
  res.json({ ok: true, ...result });
}));

module.exports = router;
module.exports.helpers = { completionPercent, normalizePeriod, validateAnswers };