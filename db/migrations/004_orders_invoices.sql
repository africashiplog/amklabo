-- AMKLABO — Phase 3 : panier, commandes, réservations de stock, factures, avoirs, notifications

-- ---------------------------------------------------------------------------
-- Réservations : le stock réservé est porté par le lot, sous contrainte.
-- On ne peut ni réserver plus que le stock physique, ni sortir du stock réservé.
-- ---------------------------------------------------------------------------
ALTER TABLE stock_lots ADD COLUMN qty_reserved int NOT NULL DEFAULT 0;
ALTER TABLE stock_lots ADD CONSTRAINT stock_lots_reserved_valid CHECK (qty_reserved >= 0 AND qty_reserved <= qty_on_hand);

-- ---------------------------------------------------------------------------
-- Panier (clients connectés)
-- ---------------------------------------------------------------------------
CREATE TABLE cart_items (
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity     int NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  added_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Commandes
-- ---------------------------------------------------------------------------
CREATE TYPE order_status AS ENUM (
  'new', 'pending_confirmation', 'confirmed', 'preparing', 'ready_to_ship',
  'out_for_delivery', 'delivered', 'cancelled', 'returned'
);
-- Statut de paiement : géré par le module paiements (Phase 4), distinct du statut de commande.
CREATE TYPE payment_status AS ENUM (
  'awaiting_payment', 'awaiting_verification', 'paid', 'refused', 'failed', 'refunded', 'partially_refunded'
);

CREATE TABLE orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                 text NOT NULL UNIQUE,
  customer_id            uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status                 order_status NOT NULL DEFAULT 'new',
  payment_status         payment_status NOT NULL DEFAULT 'awaiting_payment',
  -- Copie des informations au moment de la commande (historique indépendant des fiches).
  customer_name          text NOT NULL,
  customer_email         text,
  customer_phone         text,
  customer_type          customer_type NOT NULL,
  business_name          text,
  ship_recipient         text NOT NULL,
  ship_phone             text NOT NULL,
  ship_city              text NOT NULL,
  ship_district          text,
  ship_line1             text NOT NULL,
  ship_landmark          text,
  zone_id                uuid REFERENCES delivery_zones(id) ON DELETE RESTRICT,
  zone_name              text NOT NULL,
  subtotal_minor         bigint NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor         bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  shipping_minor         bigint NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),
  total_minor            bigint NOT NULL CHECK (total_minor >= 0),
  customer_note          text,
  idempotency_key        text NOT NULL UNIQUE,
  stock_consumed_at      timestamptz,
  cancel_requested_at    timestamptz,
  cancel_request_reason  text,
  cancelled_at           timestamptz,
  cancel_reason          text,
  placed_at              timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (total_minor = subtotal_minor + shipping_minor)
);
CREATE INDEX orders_customer_idx ON orders(customer_id, placed_at DESC);
CREATE INDEX orders_status_idx ON orders(status, placed_at DESC);

CREATE TABLE order_items (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                 uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  -- RESTRICT : un produit déjà commandé ne peut plus être supprimé (seulement archivé).
  product_id               uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku                      text NOT NULL,
  name                     text NOT NULL,
  sale_unit                sale_unit NOT NULL,
  units_per_sale_unit      int NOT NULL,
  quantity                 int NOT NULL CHECK (quantity > 0),
  unit_price_minor         bigint NOT NULL CHECK (unit_price_minor >= 0),
  retail_unit_price_minor  bigint NOT NULL CHECK (retail_unit_price_minor >= 0),
  price_source             text NOT NULL,
  price_label              text NOT NULL,
  line_total_minor         bigint NOT NULL CHECK (line_total_minor = unit_price_minor * quantity),
  UNIQUE (order_id, product_id)
);

CREATE TABLE order_status_history (
  id           bigserial PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  from_status  order_status,
  to_status    order_status NOT NULL,
  note         text,
  actor_id     uuid,
  actor_name   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history(order_id, id);

CREATE TYPE reservation_status AS ENUM ('active', 'consumed', 'released');

CREATE TABLE inventory_reservations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id  uuid NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  lot_id         uuid NOT NULL REFERENCES stock_lots(id) ON DELETE RESTRICT,
  quantity       int NOT NULL CHECK (quantity > 0),
  status         reservation_status NOT NULL DEFAULT 'active',
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE INDEX inventory_reservations_item_idx ON inventory_reservations(order_item_id);

ALTER TABLE inventory_movements ADD COLUMN order_id uuid REFERENCES orders(id) ON DELETE RESTRICT;

CREATE TYPE return_status AS ENUM ('requested', 'accepted', 'refused', 'completed');

CREATE TABLE returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  status         return_status NOT NULL DEFAULT 'requested',
  reason         text NOT NULL,
  decision_note  text,
  restocked      boolean,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  decided_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  completed_at   timestamptz
);
CREATE UNIQUE INDEX returns_one_open_per_order ON returns(order_id) WHERE status IN ('requested', 'accepted');

-- ---------------------------------------------------------------------------
-- Factures et avoirs
-- ---------------------------------------------------------------------------
CREATE TYPE invoice_kind AS ENUM ('invoice', 'credit_note');
CREATE TYPE invoice_status AS ENUM ('draft', 'issued', 'cancelled');

CREATE TABLE invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                invoice_kind NOT NULL DEFAULT 'invoice',
  -- Numéro attribué à l'émission uniquement (séquence sans trou, jamais réutilisé).
  number              text UNIQUE,
  status              invoice_status NOT NULL DEFAULT 'draft',
  order_id            uuid REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id         uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  credited_invoice_id uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  issue_date          date,
  due_date            date,
  -- Copies figées à l'émission
  seller              jsonb,
  buyer_name          text NOT NULL,
  buyer_business      text,
  buyer_address       text,
  buyer_phone         text,
  buyer_email         text,
  buyer_professional_id text,
  shipping_minor      bigint NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),
  subtotal_minor      bigint NOT NULL DEFAULT 0 CHECK (subtotal_minor >= 0),
  discount_minor      bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_minor         bigint NOT NULL DEFAULT 0 CHECK (total_minor >= 0),
  tax_rate_bp         int NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_included_minor  bigint NOT NULL DEFAULT 0 CHECK (tax_included_minor >= 0),
  amount_paid_minor   bigint NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
  payment_method      text,
  notes               text,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  issued_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  issued_at           timestamptz,
  cancelled_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  cancelled_at        timestamptz,
  cancel_reason       text,
  CHECK (total_minor = subtotal_minor + shipping_minor),
  CHECK ((kind = 'credit_note') = (credited_invoice_id IS NOT NULL)),
  CHECK (status = 'draft' OR (number IS NOT NULL AND issue_date IS NOT NULL AND seller IS NOT NULL)),
  CHECK (status <> 'cancelled' OR (cancel_reason IS NOT NULL AND cancelled_at IS NOT NULL))
);
-- Une seule facture non annulée par commande.
CREATE UNIQUE INDEX invoices_one_per_order ON invoices(order_id) WHERE kind = 'invoice' AND status <> 'cancelled';
CREATE INDEX invoices_customer_idx ON invoices(customer_id, created_at DESC);
CREATE INDEX invoices_status_idx ON invoices(status, issue_date DESC);

CREATE TABLE invoice_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES products(id) ON DELETE RESTRICT,
  sku               text,
  description       text NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  unit_label        text NOT NULL DEFAULT 'pièce',
  quantity          int NOT NULL CHECK (quantity > 0),
  unit_price_minor  bigint NOT NULL CHECK (unit_price_minor >= 0),
  -- Remise par ligne par rapport au prix public (informative).
  discount_minor    bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  line_total_minor  bigint NOT NULL CHECK (line_total_minor = unit_price_minor * quantity),
  sort_order        int NOT NULL DEFAULT 0
);
CREATE INDEX invoice_items_invoice_idx ON invoice_items(invoice_id, sort_order);

-- Une facture émise est figée : seuls l'annulation documentée et le suivi des
-- règlements peuvent encore changer. Une facture non brouillon ne se supprime pas.
CREATE FUNCTION invoices_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Une facture émise ne peut pas être supprimée (%).', OLD.number;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'cancelled' AND (NEW.status, NEW.amount_paid_minor) IS DISTINCT FROM (OLD.status, OLD.amount_paid_minor) THEN
    RAISE EXCEPTION 'La facture annulée % est définitive.', OLD.number;
  END IF;
  IF OLD.status <> 'draft' THEN
    IF NEW.status = 'draft' THEN
      RAISE EXCEPTION 'Une facture émise ne peut pas redevenir un brouillon.';
    END IF;
    IF (NEW.kind, NEW.number, NEW.order_id, NEW.customer_id, NEW.credited_invoice_id, NEW.issue_date, NEW.due_date,
        NEW.seller, NEW.buyer_name, NEW.buyer_business, NEW.buyer_address, NEW.buyer_phone, NEW.buyer_email,
        NEW.buyer_professional_id, NEW.shipping_minor, NEW.subtotal_minor, NEW.discount_minor, NEW.total_minor,
        NEW.tax_rate_bp, NEW.tax_included_minor, NEW.notes, NEW.issued_by, NEW.issued_at)
       IS DISTINCT FROM
       (OLD.kind, OLD.number, OLD.order_id, OLD.customer_id, OLD.credited_invoice_id, OLD.issue_date, OLD.due_date,
        OLD.seller, OLD.buyer_name, OLD.buyer_business, OLD.buyer_address, OLD.buyer_phone, OLD.buyer_email,
        OLD.buyer_professional_id, OLD.shipping_minor, OLD.subtotal_minor, OLD.discount_minor, OLD.total_minor,
        OLD.tax_rate_bp, OLD.tax_included_minor, OLD.notes, OLD.issued_by, OLD.issued_at) THEN
      RAISE EXCEPTION 'La facture émise % ne peut pas être modifiée : utilisez un avoir ou une annulation.', OLD.number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoices_protect_update BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_protect();

CREATE FUNCTION invoice_items_protect() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st invoice_status;
BEGIN
  SELECT status INTO st FROM invoices WHERE id = coalesce(NEW.invoice_id, OLD.invoice_id);
  -- st est NULL lors de la suppression en cascade d'un brouillon.
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Les lignes d''une facture émise ne peuvent pas être modifiées.';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
CREATE TRIGGER invoice_items_protect BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION invoice_items_protect();

-- Historique des statuts : ajout seul.
CREATE TRIGGER order_status_history_no_update BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- ---------------------------------------------------------------------------
-- Notifications internes (aucun e-mail/SMS configuré)
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);

-- Paramètres fiscaux et de facturation (à valider par AMKLABO).
ALTER TABLE store_settings
  ADD COLUMN tax_rate_bp int NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  ADD COLUMN tax_label text NOT NULL DEFAULT 'TVA',
  ADD COLUMN invoice_due_days int NOT NULL DEFAULT 0 CHECK (invoice_due_days BETWEEN 0 AND 365);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders', 'invoices']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;
