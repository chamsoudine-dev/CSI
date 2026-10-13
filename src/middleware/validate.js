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

const changementMotDePasseSchema = Joi.object({
  ancien_mot_de_passe: Joi.string().required().messages({
    'any.required': 'Ancien mot de passe requis'
  }),
  nouveau_mot_de_passe: Joi.string().min(8).required().messages({
    'string.min': 'Le nouveau mot de passe doit comporter au moins 8 caractères',
    'any.required': 'Nouveau mot de passe requis'
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

const utilisateurUpdateSchema = Joi.object({
  email: Joi.string().email().optional(),
  nom: Joi.string().min(2).max(100).optional(),
  mot_de_passe: Joi.string().min(8).allow('', null).optional(),
  role: Joi.string().valid('agent', 'superviseur', 'admin').optional(),
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
  jours_rupture: Joi.number().integer().min(0).max(31).default(0)
});

const rapportSchema = Joi.object({
  csi_id: Joi.number().integer().positive().required(),
  mois: Joi.string().pattern(/^\d{4}-\d{2}$/).required().messages({ 'string.pattern.base': 'Format mois invalide (YYYY-MM)' }),
  consultations: Joi.array().items(consultationSchema).default([]),
  vaccinations: Joi.array().items(vaccinationSchema).default([]),
  medicaments: Joi.array().items(medicamentSchema).default([])
});

// ─── 2.5 Nouveaux Schémas Santé Maternelle & Ravitaillement ──────────────────

const naissanceSchema = Joi.object({
  csi_id: Joi.number().integer().positive().required().messages({ 'any.required': 'CSI obligatoire' }),
  nom_nouveau_ne: Joi.string().max(150).allow(null, '').optional(),
  nom_mere: Joi.string().min(2).max(150).required().messages({ 'any.required': 'Nom de la mère requis' }),
  age_mere: Joi.number().integer().min(10).max(65).allow(null).optional(),
  sexe: Joi.string().valid('M', 'F').required().messages({ 'any.required': 'Sexe requis (M ou F)' }),
  date_naissance: Joi.string().isoDate().required().messages({ 'any.required': 'Date de naissance requise' }),
  heure_naissance: Joi.string().allow(null, '').optional(),
  poids_grammes: Joi.number().integer().min(400).max(7000).required().messages({ 'any.required': 'Poids de naissance requis' }),
  taille_cm: Joi.number().min(20).max(70).allow(null).optional(),
  etat_naissance: Joi.string().valid('VIVANT', 'MORT_NE_FRAIS', 'MORT_NE_MACERE').default('VIVANT'),
  type_accouchement: Joi.string().valid('EUTOCIQUE', 'DYSTOCIQUE', 'CESARIENNE').default('EUTOCIQUE'),
  bcg_fait: Joi.boolean().default(true),
  vpo0_fait: Joi.boolean().default(true),
  observations: Joi.string().max(500).allow(null, '').optional()
});

const cpnSchema = Joi.object({
  csi_id: Joi.number().integer().positive().required().messages({ 'any.required': 'CSI requis' }),
  nom_femme: Joi.string().min(2).max(150).required().messages({ 'any.required': 'Nom de la femme requis' }),
  age: Joi.number().integer().min(10).max(65).allow(null).optional(),
  date_consultation: Joi.string().isoDate().required().messages({ 'any.required': 'Date de consultation requise' }),
  type_cpn: Joi.string().valid('CPN1', 'CPN2', 'CPN3', 'CPN4_PLUS').required().messages({ 'any.required': 'Type de CPN requis' }),
  terme_semaines: Joi.number().integer().min(1).max(45).allow(null).optional(),
  tpi_paludisme: Joi.boolean().default(false),
  vat_tetanos: Joi.boolean().default(false),
  fer_acide_folique: Joi.boolean().default(true),
  tension_arterielle: Joi.string().max(20).allow(null, '').optional(),
  grossesse_a_risque: Joi.boolean().default(false),
  motif_risque: Joi.string().max(300).allow(null, '').optional(),
  observations: Joi.string().max(500).allow(null, '').optional()
});

const cponSchema = Joi.object({
  csi_id: Joi.number().integer().positive().required().messages({ 'any.required': 'CSI requis' }),
  nom_femme: Joi.string().min(2).max(150).required().messages({ 'any.required': 'Nom de la femme requis' }),
  date_consultation: Joi.string().isoDate().required().messages({ 'any.required': 'Date de consultation requise' }),
  type_cpon: Joi.string().valid('CPON1_24H', 'CPON2_J6_J14', 'CPON3_J42').required().messages({ 'any.required': 'Type de CPON requis' }),
  etat_mere: Joi.string().valid('BON', 'MOYEN', 'CRITIQUE').default('BON'),
  etat_bebe: Joi.string().valid('BON', 'MOYEN', 'CRITIQUE').default('BON'),
  allaitement_exclusif: Joi.boolean().default(true),
  contraception_postpartum: Joi.boolean().default(false),
  complications: Joi.string().max(300).allow(null, '').optional(),
  observations: Joi.string().max(500).allow(null, '').optional()
});

const ravitaillementLigneSchema = Joi.object({
  medicament_id: Joi.number().integer().positive().required(),
  quantite_demandee: Joi.number().integer().positive().required(),
  stock_actuel_csi: Joi.number().integer().min(0).default(0),
  notes: Joi.string().max(300).allow(null, '').optional()
});

const ravitaillementSchema = Joi.object({
  csi_id: Joi.number().integer().positive().required().messages({ 'any.required': 'CSI requis' }),
  priorite: Joi.string().valid('NORMALE', 'URGENTE', 'CRITIQUE_RUPTURE').default('NORMALE'),
  motif: Joi.string().max(500).allow(null, '').optional(),
  lignes: Joi.array().items(ravitaillementLigneSchema).min(1).required().messages({
    'array.min': 'Au moins un médicament doit être commandé',
    'any.required': 'Liste des médicaments obligatoire'
  })
});

const ravitaillementStatutSchema = Joi.object({
  statut: Joi.string().valid('DEMANDE', 'EN_REVUE', 'APPROUVE', 'EXPEDIE', 'LIVRE', 'REJETE').required(),
  reponse_notes: Joi.string().max(500).allow(null, '').optional(),
  lignes_accorde: Joi.array().items(
    Joi.object({
      ligne_id: Joi.number().integer().positive().required(),
      quantite_accordee: Joi.number().integer().min(0).required()
    })
  ).optional()
});

module.exports = {
  validate,
  schemas: {
    loginSchema,
    changementMotDePasseSchema,
    utilisateurSchema,
    utilisateurUpdateSchema,
    csiSchema,
    rapportSchema,
    naissanceSchema,
    cpnSchema,
    cponSchema,
    ravitaillementSchema,
    ravitaillementStatutSchema
  }
};
