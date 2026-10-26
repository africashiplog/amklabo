-- AMKLABO — frais de livraison fixés manuellement, images d'illustration, pages juridiques en PDF

-- ---------------------------------------------------------------------------
-- Frais de livraison : fixes (montant de la zone) ou manuels (fixés par l'équipe
-- selon la quantité et l'adresse, avant confirmation de la commande).
-- ---------------------------------------------------------------------------
ALTER TABLE delivery_zones ADD COLUMN fee_mode text NOT NULL DEFAULT 'fixed' CHECK (fee_mode IN ('fixed', 'manual'));

ALTER TABLE orders ADD COLUMN shipping_pending boolean NOT NULL DEFAULT false;
-- Tant que les frais ne sont pas fixés, la commande ne peut pas dépasser l'attente de confirmation.
ALTER TABLE orders ADD CONSTRAINT orders_shipping_pending_status
  CHECK (NOT shipping_pending OR status IN ('new', 'pending_confirmation', 'cancelled'));

-- ---------------------------------------------------------------------------
-- Images d'illustration : photo générique, le produit livré peut différer.
-- ---------------------------------------------------------------------------
ALTER TABLE product_images ADD COLUMN is_illustration boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Pages de contenu : document PDF officiel facultatif (téléchargeable).
-- ---------------------------------------------------------------------------
ALTER TABLE content_pages ADD COLUMN pdf_path text
  CHECK (pdf_path IS NULL OR pdf_path ~ '^documents/[0-9a-f-]{36}\.pdf$');
