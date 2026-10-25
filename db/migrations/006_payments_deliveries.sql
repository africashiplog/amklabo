-- AMKLABO — Phase 4 : paiements (vérification manuelle) et livraisons

ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'partially_paid' AFTER 'awaiting_verification';

-- ---------------------------------------------------------------------------
-- Moyens de paiement : désactivés tant qu'AMKLABO n'a pas saisi ses comptes officiels.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_methods (
  code               text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  name               text NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('cash_on_delivery', 'mobile_money')),
  is_active          boolean NOT NULL DEFAULT false,
  instructions       text,
  merchant_account   text,
  reference_label    text NOT NULL DEFAULT 'Référence de la transaction',
  requires_reference boolean NOT NULL DEFAULT true,
  allows_proof       boolean NOT NULL DEFAULT true,
  sort_order         int NOT NULL DEFAULT 0,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Un moyen de paiement électronique ne peut être activé sans compte marchand.
  CHECK (NOT is_active OR kind = 'cash_on_delivery' OR (merchant_account IS NOT NULL AND length(trim(merchant_account)) > 0))
);

INSERT INTO payment_methods (code, name, kind, requires_reference, allows_proof, sort_order) VALUES
  ('cash_on_delivery', 'Paiement en espèces à la livraison', 'cash_on_delivery', false, false, 0),
  ('bankily', 'Bankily', 'mobile_money', true, true, 1),
  ('masrivi', 'Masrivi', 'mobile_money', true, true, 2),
  ('sedad', 'Sedad', 'mobile_money', true, true, 3),
  ('bimbank', 'Bimbank', 'mobile_money', true, true, 4),
  ('click', 'Click', 'mobile_money', true, true, 5);

ALTER TABLE orders ADD COLUMN payment_method_code text REFERENCES payment_methods(code) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- Paiements et remboursements
-- ---------------------------------------------------------------------------
CREATE TYPE payment_record_status AS ENUM ('pending_verification', 'confirmed', 'refused', 'failed');
CREATE TYPE payment_kind AS ENUM ('payment', 'refund');

CREATE TABLE payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                  payment_kind NOT NULL DEFAULT 'payment',
  order_id              uuid REFERENCES orders(id) ON DELETE RESTRICT,
  invoice_id            uuid REFERENCES invoices(id) ON DELETE RESTRICT,
  method_code           text NOT NULL REFERENCES payment_methods(code) ON DELETE RESTRICT,
  amount_minor          bigint NOT NULL CHECK (amount_minor > 0),
  status                payment_record_status NOT NULL DEFAULT 'pending_verification',
  transaction_reference text CHECK (transaction_reference IS NULL OR transaction_reference ~ '^[A-Za-z0-9._/-]{3,64}$'),
  payer_phone           text,
  proof_path            text,
  note                  text,
  submitted_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  submitted_at          timestamptz NOT NULL DEFAULT now(),
  verified_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  verified_at           timestamptz,
  decision_note         text,
  CHECK ((order_id IS NOT NULL) <> (invoice_id IS NOT NULL)),
  CHECK (status IN ('pending_verification') OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX payments_order_idx ON payments(order_id);
CREATE INDEX payments_invoice_idx ON payments(invoice_id);
CREATE INDEX payments_status_idx ON payments(status, submitted_at);
-- Une référence de transaction ne peut justifier qu'un seul paiement (anti double paiement).
CREATE UNIQUE INDEX payments_reference_unique ON payments(method_code, upper(transaction_reference))
  WHERE transaction_reference IS NOT NULL AND kind = 'payment' AND status IN ('pending_verification', 'confirmed');

CREATE TABLE payment_events (
  id          bigserial PRIMARY KEY,
  payment_id  uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  event       text NOT NULL,
  note        text,
  actor_id    uuid,
  actor_name  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_events_payment_idx ON payment_events(payment_id, id);
CREATE TRIGGER payment_events_no_update BEFORE UPDATE OR DELETE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

-- Un paiement vérifié ne revient jamais en arrière et son montant est figé.
CREATE FUNCTION payments_protect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un paiement ne peut pas être supprimé.';
  END IF;
  IF OLD.status <> 'pending_verification' THEN
    RAISE EXCEPTION 'Le paiement a déjà été traité (%) : il ne peut plus être modifié.', OLD.status;
  END IF;
  IF (NEW.kind, NEW.order_id, NEW.invoice_id, NEW.method_code, NEW.submitted_by, NEW.submitted_at)
     IS DISTINCT FROM (OLD.kind, OLD.order_id, OLD.invoice_id, OLD.method_code, OLD.submitted_by, OLD.submitted_at) THEN
    RAISE EXCEPTION 'Champs du paiement non modifiables.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payments_protect BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_protect();

-- ---------------------------------------------------------------------------
-- Livraisons
-- ---------------------------------------------------------------------------
CREATE TYPE delivery_status AS ENUM ('pending', 'assigned', 'in_transit', 'delivered', 'failed', 'cancelled');

CREATE TABLE shipments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  status           delivery_status NOT NULL DEFAULT 'pending',
  driver_id        uuid REFERENCES users(id) ON DELETE RESTRICT,
  carrier_name     text,
  tracking_number  text,
  scheduled_for    date,
  assigned_at      timestamptz,
  delivered_at     timestamptz,
  failed_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipments_driver_idx ON shipments(driver_id, status);
CREATE INDEX shipments_status_idx ON shipments(status);
CREATE TRIGGER shipments_touch BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE shipment_events (
  id           bigserial PRIMARY KEY,
  shipment_id  uuid NOT NULL REFERENCES shipments(id) ON DELETE RESTRICT,
  status       delivery_status NOT NULL,
  note         text,
  actor_id     uuid,
  actor_name   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shipment_events_shipment_idx ON shipment_events(shipment_id, id);
CREATE TRIGGER shipment_events_no_update BEFORE UPDATE OR DELETE ON shipment_events
  FOR EACH ROW EXECUTE FUNCTION forbid_modification();

CREATE TRIGGER payment_methods_touch BEFORE UPDATE ON payment_methods FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
