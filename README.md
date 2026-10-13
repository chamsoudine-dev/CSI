# 🏥 Registre des CSI du Niger — v2.0

Système national de gestion, de suivi et de ravitaillement des **Centres de Santé Intégrés (CSI)** du Niger.
Conçu pour être déployé dans l'ensemble des formations sanitaires du pays, avec une gouvernance décentralisée et sécurisée par rôle et périmètre géographique.

---

## 🏗️ Architecture du projet

```
csi-niger/
├── server.js                   # Point d'entrée Express (sécurité, rate limiting, logging, CSP)
├── Dockerfile                  # Image Docker basée sur Node.js 20-slim
├── docker-compose.yml          # Déploiement multi-conteneurs (app, db, adminer)
├── docker-entrypoint.sh        # Entrypoint avec migrations et seeds idempotents
├── catalogue_niger.csv         # Référentiel national des médicaments essentiels
├── scripts/
│   └── backup.sh               # Script de sauvegarde automatisée pg_dump avec rétention
├── src/
│   ├── config/database.js      # Pool PostgreSQL configuré avec gestion des erreurs
│   ├── middleware/
│   │   ├── auth.js             # Authentification JWT, rechargement utilisateur et vérification d'activité
│   │   ├── scope.js            # Contrôle strict du périmètre d'accès (agent/superviseur/admin)
│   │   └── validate.js         # Validation Joi stricte des requêtes
│   ├── routes/
│   │   ├── auth.js             # Connexion, profil me, changement de mot de passe, gestion utilisateurs
│   │   ├── csi.js              # Liste et gestion des CSI avec pagination et filtres géographiques
│   │   ├── rapports.js         # Gestion des rapports mensuels d'activité et stocks
│   │   ├── stats.js            # Statistiques agrégées par région/CSI + endpoint /health enrichi
│   │   ├── catalogue.js        # Consultation du catalogue national des médicaments
│   │   ├── ravitaillement.js   # Gestion du cycle de ravitaillement avec machine d'états stricte
│   │   ├── maternite.js        # Enregistrement des naissances, CPN et CPON
│   │   ├── patients.js         # Dossiers patients, antécédents et visites
│   │   └── export.js           # Exportation CSV selon périmètre
│   └── utils/
│       ├── audit.js            # Journalisation immuable des événements d'audit
│       └── logger.js           # Logger structuré Pino
├── migrations/
│   ├── 001_schema.sql          # Schéma relationnel (régions, communes, CSI, rapports, stocks)
│   ├── 002_utilisateurs.sql    # Authentification, rôles, table d'audit
│   ├── 003_cree_par_utilisateurs.sql # Traçabilité de création des comptes
│   ├── 004_catalogue_medicaments.sql # Table du catalogue des médicaments
│   ├── 005_ravitaillement_maternite.sql # Commandes, réceptions et registre maternité
│   ├── 006_patients.sql        # Registre des patients et consultations
│   ├── run.js                  # Exécuteur idempotent des migrations SQL
│   ├── seed_admin.js           # Création sécurisée de l'administrateur national
│   ├── seed_catalogue.js       # Chargement idempotent du catalogue national
│   └── seed_profiles.js        # Comptes de test (activé via SEED_DEMO=true)
└── public/
    └── index.html              # Frontend SPA complet (HTML5, Tailwind, Alpine/Vanilla JS)
```

---

## 👥 Rôles et Périmètres de Sécurité

Le système applique un contrôle d'accès en profondeur via `src/middleware/scope.js` :
- **Agent CSI** :
  - Restreint strictement à son `csi_id`.
  - Saisie des rapports, maternité, dossiers patients et demandes de ravitaillement pour son centre.
  - Peut marquer comme `LIVRE` une commande reçue pour son propre CSI.
- **Superviseur Régional** :
  - Restreint strictement à sa `region_id`.
  - Consultation et validation des rapports et données des CSI de sa région.
  - Gestion du cycle de commande (`EN_REVUE`, `APPROUVE`, `EXPEDIE`, `REJETE`) pour sa région.
  - Création et gestion des comptes **agents** rattachés aux CSI de sa région.
- **Administrateur National** :
  - Périmètre national complet.
  - Gestion de l'ensemble des utilisateurs (sauf son auto-désactivation et la suppression du dernier admin actif).
  - Gestion des CSI, catalogues et paramètres nationaux.

---

## 🔄 Machine d'États du Ravitaillement

Les commandes de ravitaillement suivent un workflow d'approbation strict :
```
DEMANDE ──▶ EN_REVUE ──▶ APPROUVE ──▶ EXPEDIE ──▶ LIVRE
   │            │
   ▼            ▼
REJETE       REJETE
```
- **Agent** : Crée en `DEMANDE` ; peut uniquement passer en `LIVRE` à la réception.
- **Superviseur** : Transitions `EN_REVUE`, `APPROUVE`, `EXPEDIE` ou `REJETE` sur sa région.
- **Admin** : Transitions sur toute commande.
- *Toute transition illicite ou non autorisée déclenche une réponse HTTP 409 Conflict.*
- Les numéros de commande sont générés de manière atomique via une séquence PostgreSQL dédiée (`commande_numero_seq`).

---

## 🚀 Installation & Démarrage

### Option 1 — Déploiement Docker (recommandé en production)
Consultez le guide détaillé [DOCKER.md](file:///c:/Users/lenovo/Desktop/csi-niger/DOCKER.md).

```bash
cp .env.docker .env
# Définir POSTGRES_PASSWORD, JWT_SECRET, ADMIN_PASSWORD dans .env
docker compose up --build -d
```

### Option 2 — Démarrage local Node.js
```bash
# 1. Installer les dépendances
npm install

# 2. Configurer l'environnement
cp .env.example .env

# 3. Exécuter les migrations et seeds
npm run migrate
npm run seed
npm run seed:catalogue

# 4. Lancer les tests unitaires et d'intégration
npm test

# 5. Démarrer le serveur
npm start
```

---

## 📡 Référentiel des Endpoints API

| Endpoint | Méthode | Rôle requis | Périmètre appliqué | Description |
|---|---|---|---|---|
| `/api/login` | POST | Public | — | Authentification (rate limit: 15/15min) |
| `/api/me` | GET | Authentifié | Utilisateur courant | Informations du compte actif |
| `/api/me/mot-de-passe` | POST | Authentifié | Utilisateur courant | Changement de mot de passe (min. 8 car.) |
| `/api/utilisateurs` | GET, POST | Superviseur / Admin | Régional / National | Liste et création de comptes |
| `/api/utilisateurs/:id` | PUT, DELETE | Superviseur / Admin | Régional / National | Modification / désactivation |
| `/api/csi` | GET | Public | — | Liste paginée des CSI |
| `/api/csi/:id` | GET | Public | — | Fiche détaillée d'un CSI |
| `/api/catalogue` | GET | Public | — | Catalogue national des médicaments |
| `/api/stats` | GET | Authentifié | CSI / Région / National | Statistiques consolidées et tableau de bord |
| `/api/health` | GET | Public | — | Diagnostic serveur, latence DB et migrations |
| `/api/rapport` | GET, PUT | Authentifié | CSI / Région / National | Consultation et saisie des rapports |
| `/api/rapports/liste` | GET | Authentifié | CSI / Région / National | Liste filtrée des rapports |
| `/api/ravitaillement` | GET, POST | Authentifié | CSI / Région / National | Demandes et suivi des commandes |
| `/api/ravitaillement/:id/statut` | PUT | Authentifié | Selon machine d'état | Transition d'état de commande |
| `/api/maternite/naissances` | GET, POST | Authentifié | CSI / Région / National | Registre des naissances |
| `/api/maternite/cpn` | GET, POST | Authentifié | CSI / Région / National | Consultations prénatales |
| `/api/maternite/cpon` | GET, POST | Authentifié | CSI / Région / National | Consultations postnatales |
| `/api/patients` | GET, POST | Authentifié | CSI / Région / National | Liste et enregistrement de patients |
| `/api/patients/:id` | GET, PUT | Authentifié | CSI / Région / National | Fiche patient et mise à jour ciblée |
| `/api/patients/:id/visites` | POST | Authentifié | CSI / Région / National | Nouvelle visite / consultation |
| `/api/export/rapport` | GET | Authentifié | CSI / Région / National | Export CSV d'un rapport |
| `/api/export/stats` | GET | Superviseur+ | Région / National | Export CSV des statistiques |

---

## 💾 Sauvegarde de la Base de Données

Le script [scripts/backup.sh](file:///c:/Users/lenovo/Desktop/csi-niger/scripts/backup.sh) permet de réaliser un dump PostgreSQL horodaté et compressé (`.sql.gz`) :
```bash
./scripts/backup.sh
```
Il gère automatiquement la détection de l'environnement (Docker ou local) et applique une politique de rétention (suppression des archives de plus de 30 jours).
