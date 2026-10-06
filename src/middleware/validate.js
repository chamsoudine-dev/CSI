const Joi = require('joi');

/**
 * Crée un middleware de validation Joi pour req.body
 */
function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      const details = error.details.map(d => d.message).join('; ');
      return res.status(400).json({ erreur: details });
    }
    req.body = value;
    next();
  };
}

// ─── Schémas de validation ─────────────────────────────────────────────────

const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    'string.email': 'Format email invalide',
    'any.required': 'Email requis'
  }),
  mot_de_passe: Joi.string().min(6).required().messages({
    'string.min': 'Mot de passe trop court (min 6 caractères)',
    'any.required': 'Mot de passe requis'
  })
});

const utilisateurSchema = Joi.object({
  email: Joi.string().email().required(),
  nom: Joi.string().min(2).max(100).required(),
  mot_de_passe: Joi.string().min(8).optional(),
  role: Joi.string().valid('agent', 'superviseur', 'admin').required(),
  csi_id: Joi.number().integer().positive().allow(null).optional(),
  region_id: Joi.number().integer().positive().allow(null).optional(),
  actif: Joi.boolean().optional()
});

const csiSchema = Joi.object({
  nom: Joi.string().min(2).max(200).required().messages({ 'any.required': 'Nom du CSI requis' }),
  region_id: Joi.number().integer().positive().required().messages({ 'any.required': 'Région requise' }),
  commune: Joi.string().min(2).max(200).required().messages({ 'any.required': 'Commune requise' }),
  type: Joi.string().valid('rurale', 'urbaine').default('rurale'),
  latitude: Joi.number().min(-90).max(90).allow(null).optional(),
  longitude: Joi.number().min(-180).max(180).allow(null).optional(),
  services: Joi.array().items(Joi.string()).default([])
});

const consultationSchema = Joi.object({
  motif: Joi.string().required(),
  tranche: Joi.string().valid('moins5', '5plus').required(),
  sexe: Joi.string().valid('M', 'F').required(),
  nombre: Joi.number().integer().min(0).default(0)
});

const vaccinationSchema = Joi.object({
  vaccin: Joi.string().required(),
  doses: Joi.number().integer().min(0).default(0)
});

const medicamentSchema = Joi.object({
  produit: Joi.string().required(),
  stock_debut: Joi.number().integer().min(0).default(0),
  entrees: Joi.number().integer().min(0).default(0),
  sorties: Joi.number().integer().min(0).default(0),
  stock_fin: Joi.number().integer().min(0).default(0),
  jours_rupture: Joi.number().integer().min(0).default(0)
});

const rapportSchema = Joi.object({
  csi_id: Joi.number().integer().positive().required(),
  mois: Joi.string().pattern(/^\d{4}-\d{2}$/).required().messages({ 'string.pattern.base': 'Format mois invalide (YYYY-MM)' }),
  consultations: Joi.array().items(consultationSchema).default([]),
  vaccinations: Joi.array().items(vaccinationSchema).default([]),
  medicaments: Joi.array().items(medicamentSchema).default([])
});

module.exports = {
  validate,
  schemas: { loginSchema, utilisateurSchema, csiSchema, rapportSchema }
};
