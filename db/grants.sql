-- Droits du rôle applicatif (réappliqués après chaque migration).
-- L'application ne peut ni modifier ni supprimer le journal d'audit,
-- ni modifier le schéma.
GRANT USAGE ON SCHEMA public TO amklabo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO amklabo_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM amklabo_app;
REVOKE ALL ON schema_migrations FROM amklabo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO amklabo_app;
