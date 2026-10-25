-- AMKLABO — Phase 2 : comptes professionnels, tarification, stock, fournisseurs, clients

-- ---------------------------------------------------------------------------
-- Numérotation séquentielle sans trou (bons d'achat, puis commandes, factures)
-- ---------------------------------------------------------------------------
CREATE TABLE document_sequences (
  name        text NOT NULL,
  year        int NOT NULL,
  last_value  int NOT NULL DEFAULT 0,
  PRIMARY KEY (name, year)
);

-- ---------------------------------------------------------------------------
-- Comptes professionnels
-- ---------------------------------------------------------------------------
CREATE TYPE business_activity AS ENUM (
  'laboratory', 'clinic', 'hospital', 'pharmacy', 'medical_office', 'distributor', 'company', 'other'
);
CREATE TYPE business_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');

CREATE TABLE business_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id        uuid NOT NULL UNIQUE REFERENCES customers(id) ON DELETE CASCADE,
  establishment_name text NOT NULL CHECK (length(establishment_name) BETWEEN 2 AND 200),
  activity           business_activity NOT NULL,
  contact_name       text NOT NULL,
  phone              text NOT NULL,
  email              citext,
  address_line       text NOT NULL,
  city               text NOT NULL,
  professional_id    text,
  message            text,
  status             business_status NOT NULL DEFAULT 'pending',
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  reviewed_at        timestamptz,
  reviewed_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_reason    text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_accounts_status_idx ON business_accounts(status);

-- Notes internes : ajout uniquement, jamais visibles par le client.
CREATE TABLE customer_notes (
  id           bigserial PRIMARY KEY,
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_notes_customer_idx ON customer_notes(customer_id, created_at DESC);
ALTER TABLE customers DROP COLUMN internal_notes;
ALTER TABLE customers ADD COLUMN anonymized_at timestamptz;

-- ---------------------------------------------------------------------------
-- Tarification
-- ---------------------------------------------------------------------------
CREATE TYPE price_audience AS ENUM ('all', 'retail', 'business');

-- Paliers de quantité. 'all' : remise quantité pour tous ; 'business' : réservé
-- aux comptes professionnels approuvés.
CREATE TABLE price_tiers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  audience          price_audience NOT NULL DEFAULT 'business' CHECK (audience IN ('all', 'business')),
  min_qty           int NOT NULL CHECK (min_qty >= 1),
  unit_price_minor  bigint NOT NULL CHECK (unit_price_minor > 0),
  valid_from        date,
  valid_to          date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX price_tiers_product_idx ON price_tiers(product_id, audience, min_qty);

-- Prix négociés par client professionnel.
CREATE TABLE customer_prices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id       uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  min_qty           int NOT NULL DEFAULT 1 CHECK (min_qty >= 1),
  unit_price_minor  bigint NOT NULL CHECK (unit_price_minor > 0),
  valid_from        date,
  valid_to          date,
  note              text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, product_id, min_qty),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX customer_prices_lookup_idx ON customer_prices(customer_id, product_id);

CREATE TYPE discount_type AS ENUM ('percent', 'amount');

CREATE TABLE promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  product_id       uuid REFERENCES products(id) ON DELETE CASCADE,
  category_id      uuid REFERENCES categories(id) ON DELETE CASCADE,
  audience         price_audience NOT NULL DEFAULT 'all',
  discount_type    discount_type NOT NULL,
  -- percent : centièmes de pourcent (1000 = 10 %) ; amount : remise par unité en unités mineures
  discount_value   bigint NOT NULL CHECK (discount_value > 0),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((product_id IS NULL) <> (category_id IS NULL)),
  CHECK (discount_type <> 'percent' OR discount_value <= 9000)
);
CREATE INDEX promotions_active_idx ON promotions(is_active, starts_at, ends_at);

-- ---------------------------------------------------------------------------
-- Fournisseurs et achats
-- ---------------------------------------------------------------------------
CREATE TABLE suppliers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL UNIQUE CHECK (length(name) BETWEEN 2 AND 200),
  contact_name  text,
  phone         text,
  email         citext,
  address       text,
  country       text,
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_suppliers (
  product_id      uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_sku    text,
  last_cost_minor bigint CHECK (last_cost_minor IS NULL OR last_cost_minor >= 0),
  PRIMARY KEY (product_id, supplier_id)
);

CREATE TYPE purchase_status AS ENUM ('draft', 'ordered', 'partially_received', 'received', 'cancelled');

CREATE TABLE purchase_orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number       text NOT NULL UNIQUE,
  supplier_id  uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status       purchase_status NOT NULL DEFAULT 'draft',
  ordered_at   timestamptz,
  expected_at  date,
  notes        text,
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_orders_supplier_idx ON purchase_orders(supplier_id);

CREATE TABLE purchase_order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_ordered      int NOT NULL CHECK (qty_ordered > 0),
  qty_received     int NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost_minor  bigint CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0),
  UNIQUE (purchase_order_id, product_id),
  CHECK (qty_received <= qty_ordered)
);

-- ---------------------------------------------------------------------------
-- Stock : lots et mouvements
-- Les quantités sont exprimées en unités de vente du produit.
-- ---------------------------------------------------------------------------
CREATE TABLE stock_lots (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id             uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_number             text,
  expiry_date            date,
  -- Contrainte en base : le stock d'un lot ne peut jamais devenir négatif.
  qty_on_hand            int NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  supplier_id            uuid REFERENCES suppliers(id) ON DELETE RESTRICT,
  purchase_order_item_id uuid REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  unit_cost_minor        bigint CHECK (unit_cost_minor IS NULL OR unit_cost_minor >= 0),
  received_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_lots_product_idx ON stock_lots(product_id, expiry_date NULLS LAST);
CREATE INDEX stock_lots_expiry_idx ON stock_lots(expiry_date) WHERE qty_on_hand > 0;

CREATE TYPE movement_type AS ENUM (
  'purchase_receipt', 'manual_in', 'adjustment_in', 'adjustment_out',
  'return_in', 'return_to_supplier', 'loss', 'expiry_writeoff', 'sale_out'
);

CREATE TABLE inventory_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_id            uuid NOT NULL REFERENCES stock_lots(id) ON DELETE RESTRICT,
  movement_type     movement_type NOT NULL,
  quantity          int NOT NULL CHECK (quantity <> 0),
  balance_after     int NOT NULL CHECK (balance_after >= 0),
  reason            text,
  purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (movement_type IN ('purchase_receipt', 'manual_in', 'adjustment_in', 'return_in') AND quantity > 0) OR
    (movement_type IN ('adjustment_out', 'return_to_supplier', 'loss', 'expiry_writeoff', 'sale_out') AND quantity < 0)
  )
);
CREATE INDEX inventory_movements_product_idx ON inventory_movements(product_id, created_at DESC);

-- Historiques immuables : mouvements de stock et notes internes.
CREATE FUNCTION forbid_modification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en ajout seul (opération % refusée)', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER inventory_movements_no_update BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER inventory_movements_no_truncate BEFORE TRUNCATE ON inventory_movements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_modification();
CREATE TRIGGER customer_notes_no_update BEFORE UPDATE ON customer_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- Seuil d'alerte de péremption (jours), configurable.
ALTER TABLE store_settings ADD COLUMN expiry_alert_days int NOT NULL DEFAULT 90 CHECK (expiry_alert_days BETWEEN 1 AND 730);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_accounts', 'promotions', 'suppliers', 'purchase_orders']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;
