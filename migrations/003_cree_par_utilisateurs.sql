-- ============================================================
-- Migration 003 — Ajout du champ cree_par sur les utilisateurs
-- CSI Niger v2.0
-- Permet de tracer quel administrateur a créé quel utilisateur
-- et de restreindre modification / suppression aux créateurs
-- ============================================================

ALTER TABLE utilisateurs 
ADD COLUMN IF NOT EXISTS cree_par INT REFERENCES utilisateurs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_utilisateurs_cree_par ON utilisateurs(cree_par);

-- Pour les utilisateurs déjà existants sans créateur, les lier au premier admin
UPDATE utilisateurs 
SET cree_par = (SELECT id FROM utilisateurs WHERE role = 'admin' ORDER BY id ASC LIMIT 1)
WHERE cree_par IS NULL AND role != 'admin';
