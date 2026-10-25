-- Délai pendant lequel un client peut demander un retour après livraison (0 = désactivé).
ALTER TABLE store_settings ADD COLUMN return_window_days int NOT NULL DEFAULT 7 CHECK (return_window_days BETWEEN 0 AND 365);
-- Date de livraison effective, pour appliquer ce délai.
ALTER TABLE orders ADD COLUMN delivered_at timestamptz;
