-- AMKLABO — Phase 1 : fondation (identité, rôles, catalogue, paramètres, audit)
-- Montants : stockés en unités mineures (1 MRU = 100 unités) dans des BIGINT.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Types énumérés
-- ---------------------------------------------------------------------------
CREATE TYPE app_role AS ENUM (
  'admin',
  'stock_manager',
  'order_manager',
  'accountant',
  'delivery',
  'customer_retail',
  'customer_business'
);

CREATE TYPE user_status AS ENUM ('active', 'suspended', 'archived');
CREATE TYPE customer_type AS ENUM ('retail', 'business');
CREATE TYPE product_status AS ENUM ('draft', 'published', 'unavailable', 'archived');
CREATE TYPE sale_unit AS ENUM ('piece', 'box', 'pack', 'carton', 'lot');

-- ---------------------------------------------------------------------------
-- Comptes et sessions
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  password_hash   text NOT NULL,
  status          user_status NOT NULL DEFAULT 'active',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);

CREATE TABLE profiles (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  full_name   text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  phone       text CHECK (phone IS NULL OR length(phone) <= 30),
  locale      text NOT NULL DEFAULT 'fr' CHECK (locale IN ('fr', 'ar')),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        app_role NOT NULL,
  granted_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

-- Seul le hachage SHA-256 du jeton de session est stocké.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   bytea NOT NULL UNIQUE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  ip           inet,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expires_idx ON sessions(expires_at);

-- Tentatives de connexion (limitation anti force brute).
CREATE TABLE login_attempts (
  id          bigserial PRIMARY KEY,
  email       citext NOT NULL,
  ip          inet,
  succeeded   boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_time_idx ON login_attempts(email, created_at DESC);
CREATE INDEX login_attempts_ip_time_idx ON login_attempts(ip, created_at DESC);

-- ---------------------------------------------------------------------------
-- Clients et adresses
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  customer_type  customer_type NOT NULL DEFAULT 'retail',
  full_name      text NOT NULL,
  email          citext,
  phone          text,
  status         user_status NOT NULL DEFAULT 'active',
  internal_notes text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON customers(lower(full_name));

CREATE TABLE delivery_zones (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                       text NOT NULL UNIQUE,
  city                       text NOT NULL,
  fee_minor                  bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
  free_shipping_threshold_minor bigint CHECK (free_shipping_threshold_minor IS NULL OR free_shipping_threshold_minor >= 0),
  is_active                  boolean NOT NULL DEFAULT false,
  sort_order                 int NOT NULL DEFAULT 0,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label         text NOT NULL DEFAULT 'Adresse',
  recipient     text NOT NULL,
  phone         text NOT NULL,
  city          text NOT NULL,
  district      text,
  line1         text NOT NULL,
  landmark      text,
  zone_id       uuid REFERENCES delivery_zones(id) ON DELETE SET NULL,
  is_default    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX addresses_customer_idx ON addresses(customer_id);
CREATE UNIQUE INDEX addresses_one_default ON addresses(customer_id) WHERE is_default;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    uuid REFERENCES categories(id) ON DELETE RESTRICT,
  name         text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description  text,
  sort_order   int NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX categories_parent_idx ON categories(parent_id);

CREATE TABLE products (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku                    citext NOT NULL UNIQUE CHECK (length(sku) BETWEEN 2 AND 64),
  barcode                text,
  name                   text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  slug                   text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description            text,
  -- RESTRICT : une catégorie contenant des produits ne peut pas être supprimée.
  category_id            uuid REFERENCES categories(id) ON DELETE RESTRICT,
  brand                  text,
  manufacturer           text,
  -- Spécifications techniques : tableau [{ "label": "...", "value": "..." }]
  specs                  jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(specs) = 'array'),
  sale_unit              sale_unit NOT NULL DEFAULT 'piece',
  units_per_sale_unit    int NOT NULL DEFAULT 1 CHECK (units_per_sale_unit >= 1),
  retail_price_minor     bigint NOT NULL CHECK (retail_price_minor >= 0),
  min_order_qty          int NOT NULL DEFAULT 1 CHECK (min_order_qty >= 1),
  stock_alert_threshold  int NOT NULL DEFAULT 0 CHECK (stock_alert_threshold >= 0),
  track_lots             boolean NOT NULL DEFAULT false,
  status                 product_status NOT NULL DEFAULT 'draft',
  is_featured            boolean NOT NULL DEFAULT false,
  published_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_idx ON products(category_id);
CREATE INDEX products_status_idx ON products(status);
CREATE INDEX products_search_idx ON products
  USING gin (to_tsvector('french', coalesce(name, '') || ' ' || coalesce(brand, '') || ' ' || coalesce(description, '')));

CREATE TABLE product_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  alt           text,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_images_product_idx ON product_images(product_id, sort_order);

-- ---------------------------------------------------------------------------
-- Paramètres du magasin (ligne unique) et pages de contenu
-- ---------------------------------------------------------------------------
CREATE TABLE store_settings (
  id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  store_name         text NOT NULL DEFAULT 'AMKLABO',
  tagline            text NOT NULL DEFAULT 'Medical & Laboratory',
  logo_path          text,
  email              text,
  phone              text,
  whatsapp           text,
  address_line       text,
  city               text DEFAULT 'Nouakchott',
  country            text NOT NULL DEFAULT 'Mauritanie',
  currency           text NOT NULL DEFAULT 'MRU' CHECK (currency = 'MRU'),
  opening_hours      text,
  legal_name         text,
  tax_id             text,
  trade_register     text,
  bank_details       text,
  invoice_footer     text,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE content_pages (
  slug        text PRIMARY KEY,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE contact_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       citext,
  phone       text,
  subject     text NOT NULL,
  message     text NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  handled_at  timestamptz,
  handled_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_messages_created_idx ON contact_messages(created_at DESC);

-- ---------------------------------------------------------------------------
-- Journal d'audit : insertion uniquement.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           bigserial PRIMARY KEY,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email  text,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text,
  before_data  jsonb,
  after_data   jsonb,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs(created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est en lecture seule (opération % refusée)', TG_OP;
END;
$$;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- Horodatage automatique
-- ---------------------------------------------------------------------------
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','profiles','customers','delivery_zones','addresses',
                           'categories','products','store_settings','content_pages']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()', t, t);
  END LOOP;
END $$;
