-- Le journal d'audit est immuable : la suppression d'un utilisateur ne doit pas
-- tenter de réécrire actor_id (ON DELETE SET NULL serait un UPDATE refusé).
-- L'identifiant de l'auteur est conservé tel quel, sans contrainte de clé étrangère.
ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_actor_id_fkey;
