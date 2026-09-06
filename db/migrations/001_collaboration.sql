CREATE TABLE vn_clients (
 id uuid PRIMARY KEY, name text NOT NULL DEFAULT 'New client', channel text NOT NULL DEFAULT 'manual',
 handle text, language text, demo boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vn_conversations (
 id uuid PRIMARY KEY, client_id uuid NOT NULL REFERENCES vn_clients(id),
 mode text NOT NULL DEFAULT 'EMILY' CHECK(mode IN ('EMILY','CONSULT','REVIEW','HUMAN')),
 owner text, needs_human boolean NOT NULL DEFAULT false, unread integer NOT NULL DEFAULT 0,
 version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vn_commissions (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL UNIQUE REFERENCES vn_conversations(id),
 stage text NOT NULL DEFAULT 'NEW' CHECK(stage IN ('NEW','EXPLORING','DESIGN_DIRECTION','QUALIFIED','DESIGNER_REVIEW','QUOTED','DEPOSIT_PENDING','DEPOSIT_PAID','DESIGN_REFINEMENT','DESIGN_APPROVED','IN_PRODUCTION','FINAL_REVIEW','REVISION','READY_TO_SHIP','SHIPPED','DELIVERED','AFTERCARE')),
 design_refinements integer NOT NULL DEFAULT 0, final_adjustments integer NOT NULL DEFAULT 0
);
CREATE TABLE vn_messages (
 id uuid PRIMARY KEY, sequence bigserial UNIQUE, conversation_id uuid NOT NULL REFERENCES vn_conversations(id),
 role text NOT NULL CHECK(role IN ('customer','emily','human_internal','human_customer_facing','system')),
 content text NOT NULL, actor text NOT NULL, delivery text NOT NULL CHECK(delivery IN ('received','internal','approved','sent_simulated')),
 external_id text, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((role IN ('human_internal','system') AND delivery='internal') OR (role='customer' AND delivery='received') OR (role IN ('emily','human_customer_facing') AND delivery IN ('approved','sent_simulated')))
);
CREATE UNIQUE INDEX vn_message_external ON vn_messages(conversation_id,external_id) WHERE external_id IS NOT NULL;
CREATE INDEX vn_message_thread ON vn_messages(conversation_id,created_at);
CREATE TABLE vn_facts (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES vn_conversations(id), key text NOT NULL,
 value jsonb NOT NULL, source text NOT NULL CHECK(source IN ('system','shopify','human','designer','customer','ai')),
 confirmed boolean NOT NULL, authority integer NOT NULL, evidence text NOT NULL, actor text NOT NULL,
 message_id uuid REFERENCES vn_messages(id), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(conversation_id,key),
 CHECK(authority = CASE WHEN source IN ('system','shopify') AND confirmed THEN 4 WHEN source IN ('human','designer') AND confirmed THEN 3 WHEN source='customer' THEN 2 ELSE 1 END)
);
CREATE TABLE vn_consultations (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES vn_conversations(id), question text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered')), answer_message_id uuid REFERENCES vn_messages(id),
 reviewed_by text, confirmed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vn_reviews (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES vn_conversations(id), note_message_id uuid NOT NULL REFERENCES vn_messages(id),
 draft jsonb NOT NULL, edited jsonb, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','stale')),
 context_version integer NOT NULL, approved_by text, approved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vn_audit (
 id bigserial PRIMARY KEY, conversation_id uuid REFERENCES vn_conversations(id), event text NOT NULL,
 actor text NOT NULL, detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vn_references (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES vn_conversations(id), name text NOT NULL,
 url text, mime_type text, source text NOT NULL, reviewed_by text, reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION vn_protect_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.authority < OLD.authority THEN RAISE EXCEPTION 'Lower authority cannot overwrite confirmed fact'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vn_fact_authority BEFORE UPDATE ON vn_facts FOR EACH ROW EXECUTE FUNCTION vn_protect_fact();
CREATE FUNCTION vn_protect_send() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_mode text;
BEGIN
 SELECT mode INTO current_mode FROM vn_conversations WHERE id=NEW.conversation_id FOR UPDATE;
 IF NEW.role='emily' AND current_mode <> 'EMILY' AND NOT (current_mode='REVIEW' AND NEW.delivery='approved') THEN RAISE EXCEPTION 'Emily send blocked by conversation mode'; END IF;
 IF NEW.role='human_customer_facing' AND current_mode <> 'HUMAN' THEN RAISE EXCEPTION 'Direct human send requires HUMAN mode'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER vn_message_mode BEFORE INSERT ON vn_messages FOR EACH ROW EXECUTE FUNCTION vn_protect_send();
