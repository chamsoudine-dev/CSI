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
│   │   ├── auth.js             # Connexion, profil, mots de passe et gestion des utilisateurs
│   │   ├── csi.js              # CSI, régions et gestion des centres
│   │   ├── rapports.js         # Rapports mensuels et workflow de validation
│   │   ├── stats.js            # Statistiques et endpoint /health
│   │   ├── dashboard.js        # Tableaux de bord par rôle
│   │   ├── catalogue.js        # Catalogue, stocks et dispensations de médicaments
│   │   ├── ravitaillement.js   # Demandes, transitions d'état et stocks
│   │   ├── maternite.js        # Naissances, consultations prénatales et postnatales
│   │   ├── patients.js         # Patients, dossiers et visites
│   │   ├── unfpa.js            # Enquêtes UNFPA et synthèses
│   │   ├── missions.js         # Missions, acceptation, périodes et suivi des réponses agents
│   │   ├── referentiels.js     # Référentiels de consultations, vaccins et services
│   │   ├── alertes.js          # Alertes épidémiologiques et retards de rapports
│   │   ├── admin.js            # Audit et paramètres système
│   │   └── export.js           # Exportations CSV selon le périmètre
│   └── utils/
│       ├── audit.js            # Journalisation immuable des événements d'audit
│       └── logger.js           # Logger structuré Pino
├── migrations/
│   ├── 001_schema.sql          # Référentiels géographiques, CSI et rapports
│   ├── 002_utilisateurs.sql    # Utilisateurs, rôles et audit
│   ├── 003_cree_par_utilisateurs.sql # Traçabilité de création des comptes
│   ├── 004_catalogue_medicaments.sql # Catalogue national des médicaments
│   ├── 005_ravitaillement_maternite.sql # Ravitaillement, naissances, CPN et CPON
│   ├── 006_patients.sql        # Patients et dossiers de consultation
│   ├── 007_workflow_rapports.sql # Validation des rapports et paramètres
│   ├── 008_enquetes_unfpa.sql  # Enquêtes UNFPA
│   ├── 009_stock_courant.sql   # Stocks courants par CSI
│   ├── 010_referentiels.sql    # Référentiels administrables
│   ├── 011_dispensations.sql   # Historique des médicaments dispensés
│   ├── 012_auth_security.sql   # Codes de validation, 2FA par e-mail et révocation des sessions
│   ├── 013_superviseur_national.sql # Rôle de supervision national sans privilèges admin
│   ├── 014_missions.sql        # Missions nationales et affectations aux agents
│   ├── 015_mission_acceptation_periode.sql # Acceptation, période et dates de suivi des missions
│   ├── run.js                  # Exécuteur idempotent des migrations SQL
│   ├── seed_admin.js           # Création sécurisée de l'administrateur national
│   ├── seed_catalogue.js       # Chargement idempotent du catalogue national
│   └── seed_profiles.js        # Comptes de test (activé via SEED_DEMO=true)
└── public/
    ├── index.html              # Structure HTML de la SPA
    ├── css/
    │   └── app.css             # Styles de l'application
    └── js/
        └── app.js              # Logique et écrans de la SPA (JavaScript natif)
```

Le navigateur reçoit l'application depuis Express (`public/`). La SPA utilise du JavaScript natif et appelle les routes JSON sous `/api`; Leaflet et les polices sont chargés depuis des CDN.

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
  - Création et gestion des comptes **agents** rattachés aux CSI de sa région, y compris leurs identifiants de connexion.
- **Superviseur National** :
  - Accès de supervision sur toutes les régions et tous les CSI.
  - Gestion des comptes agents et superviseurs régionaux, sans accès à la gestion des administrateurs, à l'audit national ni aux paramètres système.
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
Consultez le guide détaillé [DOCKER.md](./DOCKER.md).

```bash
cp .env.docker .env
# Définir POSTGRES_PASSWORD, JWT_SECRET, ADMIN_PASSWORD dans .env
docker compose up --build -d
```

### Option 2 — Démarrage local Node.js
```bash
# 1. Installer les dépendances
npm install

# 2. Vérifier la suite de tests (aucune base PostgreSQL requise)
npm test

# 3. Configurer l'environnement
cp .env.example .env
# Configurer SMTP_HOST, SMTP_FROM et les identifiants SMTP pour envoyer les codes

# Pour utiliser le PostgreSQL Docker depuis Node lancé sur l'hôte :
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db

# 4. Exécuter les migrations et seeds
npm run migrate
npm run seed
npm run seed:catalogue

# 5. Démarrer le serveur
npm start
```

## 🧪 Tests

La suite utilise le test runner intégré à Node.js (`node --test`). Elle se lance avec `npm test` et ne nécessite pas de PostgreSQL : les tests de routes qui vérifient la base simulent ses réponses. Le serveur de l'application, lui, nécessite une base configurée via `DATABASE_URL`.

### Authentification et codes e-mail

La page d’accueil affiche le formulaire de connexion. Chaque utilisateur saisit l’adresse e-mail unique et le mot de passe de son compte ; le rôle enregistré en base détermine automatiquement son espace (administrateur national, superviseur national, superviseur régional ou agent CSI) et son tableau de bord. Aucun rôle n’est sélectionné manuellement. Après une nouvelle ouverture ou actualisation de la page, une nouvelle connexion est demandée ; le jeton n’est pas conservé dans le navigateur.

La 2FA, lorsqu’elle est activée par l’utilisateur, impose un code à usage unique envoyé par e-mail. Les changements de mot de passe et les récupérations utilisent également un code à usage unique, limité dans le temps et en nombre d’essais. Configurez `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` et `SMTP_FROM` dans `.env` (ou dans l’environnement Docker) avant d’activer ces parcours. Le secret `OTP_SECRET` est recommandé ; à défaut, le code utilise `JWT_SECRET`. Aucun code n’est retourné à l’interface ni écrit dans les journaux.

---

## 📡 Référentiel des Endpoints API

| Endpoint | Méthode | Rôle requis | Périmètre appliqué | Description |
|---|---|---|---|---|
| `/api/login` | POST | Public | — | Connexion par mot de passe ; lance la vérification e-mail si 2FA activée |
| `/api/login/verify-code` | POST | Public | — | Vérification du code 2FA puis ouverture de session |
| `/api/me` | GET | Authentifié | Utilisateur courant | Informations du compte actif |
| `/api/me/mot-de-passe/demander-code` | POST | Authentifié | Utilisateur courant | Vérification du mot de passe actuel et envoi du code |
| `/api/me/mot-de-passe/valider` | POST | Authentifié | Utilisateur courant | Changement de mot de passe avec code |
| `/api/mot-de-passe-oublie` | POST | Public | — | Demande générique de code de récupération |
| `/api/mot-de-passe-oublie/valider` | POST | Public | — | Réinitialisation avec code |
| `/api/me/2fa/demander-code` | POST | Authentifié | Utilisateur courant | Demande de code pour activer/désactiver la 2FA |
| `/api/me/2fa/verifier-code` | POST | Authentifié | Utilisateur courant | Confirmation de l’activation ou désactivation 2FA |
| `/api/dashboard/agent` | GET | Agent / Admin | CSI / National | Tableau de bord agent |
| `/api/dashboard/superviseur` | GET | Superviseur / Admin | Région / National | Tableau de bord régional |
| `/api/dashboard/admin` | GET | Admin | National | Tableau de bord national |
| `/api/utilisateurs` | GET, POST | Superviseur / Admin | Régional / National | Liste et création de comptes |
| `/api/utilisateurs/:id` | PUT, DELETE | Superviseur / Admin | Régional / National | Modification / désactivation |
| `/api/csi` | GET | Public | — | Liste paginée des CSI |
| `/api/csi/:id` | GET | Public | — | Fiche détaillée d'un CSI |
| `/api/catalogue` | GET | Public | — | Recherche dans le catalogue national des médicaments |
| `/api/catalogue/classes`, `/api/catalogue/formes`, `/api/catalogue/stats` | GET | Public | — | Filtres et statistiques du catalogue |
| `/api/catalogue/dispensations` | GET, POST | Authentifié | CSI / Région / National | Historique et enregistrement des dispensations |
| `/api/catalogue/dispensations/:id` | DELETE | Authentifié | CSI / Région / National | Suppression d'une dispensation selon les droits |
| `/api/stats` | GET | Authentifié | CSI / Région / National | Statistiques consolidées et tableau de bord |
| `/api/health` | GET | Public | — | Diagnostic serveur, latence DB et migrations |
| `/api/rapport` | GET, PUT | Authentifié | CSI / Région / National | Consultation et saisie des rapports |
| `/api/rapports/liste` | GET | Authentifié | CSI / Région / National | Liste filtrée des rapports |
| `/api/ravitaillement` | GET, POST | Authentifié | CSI / Région / National | Demandes et suivi des commandes |
| `/api/ravitaillement/stock-courant` | GET | Authentifié | CSI / Région / National | Consultation des stocks courants |
| `/api/ravitaillement/rupture-rapide` | POST | Authentifié | Selon le CSI | Signalement rapide d'une rupture |
| `/api/ravitaillement/:id/statut` | PUT | Authentifié | Selon machine d'état | Transition d'état de commande |
| `/api/maternite/naissances` | GET, POST | Authentifié | CSI / Région / National | Registre des naissances |
| `/api/maternite/cpn` | GET, POST | Authentifié | CSI / Région / National | Consultations prénatales |
| `/api/maternite/cpon` | GET, POST | Authentifié | CSI / Région / National | Consultations postnatales |
| `/api/patients` | GET, POST | Authentifié | CSI / Région / National | Liste et enregistrement de patients |
| `/api/patients/:id` | GET, PUT | Authentifié | CSI / Région / National | Fiche patient et mise à jour ciblée |
| `/api/patients/:id/visites` | POST | Authentifié | CSI / Région / National | Nouvelle visite / consultation |
| `/api/unfpa` | GET, PUT | Authentifié | CSI / Région / National | Consultation et saisie des enquêtes annuelles |
| `/api/unfpa/:id/soumettre` | POST | Authentifié | CSI / Région / National | Soumission d'une enquête |
| `/api/unfpa/:id/valider` | POST | Superviseur / Admin | Région / National | Validation d'une enquête |
| `/api/unfpa/synthese` | GET | Authentifié | CSI / Région / National | Synthèse des enquêtes |
| `/api/referentiels/:type` | GET | Public | — | Consultation des référentiels |
| `/api/referentiels/:type` | POST, PUT, DELETE | Admin | National | Administration des référentiels |
| `/api/alertes/epidemiologiques` | GET | Superviseur / Admin | Région / National | Alertes épidémiologiques |
| `/api/alertes/csi-en-retard` | GET | Superviseur / Admin | Région / National | Rapports CSI en retard |
| `/api/admin/audit` | GET | Admin | National | Consultation et export du journal d'audit |
| `/api/admin/parametres` | GET, PUT | Authentifié / Admin | National | Lecture et mise à jour des paramètres système |
| `/api/export/rapport` | GET | Authentifié | CSI / Région / National | Export CSV d'un rapport |
| `/api/export/stats` | GET | Superviseur+ | Région / National | Export CSV des statistiques |

---

## 💾 Sauvegarde de la Base de Données

Le script [scripts/backup.sh](./scripts/backup.sh) permet de réaliser un dump PostgreSQL horodaté et compressé (`.sql.gz`) :
```bash
./scripts/backup.sh
```
Il gère automatiquement la détection de l'environnement (Docker ou local) et applique une politique de rétention (suppression des archives de plus de 30 jours).
