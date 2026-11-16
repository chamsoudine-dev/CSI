ALTER TABLE utilisateurs
  DROP CONSTRAINT IF EXISTS utilisateurs_role_check;

ALTER TABLE utilisateurs
  DROP CONSTRAINT IF EXISTS chk_utilisateurs_role;

ALTER TABLE utilisateurs
  ADD CONSTRAINT chk_utilisateurs_role
  CHECK (role IN ('agent', 'superviseur', 'superviseur_national', 'admin'));
