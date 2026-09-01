
ALTER TABLE public.google_connections DROP CONSTRAINT IF EXISTS google_connections_user_id_connector_id_key;
ALTER TABLE public.google_connections DROP COLUMN IF EXISTS connector_id;
ALTER TABLE public.google_connections DROP COLUMN IF EXISTS connection_id;
ALTER TABLE public.google_connections DROP COLUMN IF EXISTS scopes;

ALTER TABLE public.google_connections ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.google_connections ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'google';
ALTER TABLE public.google_connections ADD COLUMN IF NOT EXISTS connected_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.google_connections ADD CONSTRAINT google_connections_user_provider_unique UNIQUE (user_id, provider);
