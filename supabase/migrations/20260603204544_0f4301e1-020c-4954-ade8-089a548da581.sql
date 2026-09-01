
ALTER TABLE public.google_connections
  ADD COLUMN IF NOT EXISTS access_token TEXT,
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'connected',
  ADD COLUMN IF NOT EXISTS scope TEXT;

-- Table d'états OAuth (CSRF + lien vers user_id)
CREATE TABLE IF NOT EXISTS public.google_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.google_oauth_states TO service_role;
ALTER TABLE public.google_oauth_states ENABLE ROW LEVEL SECURITY;
-- Pas de policies pour authenticated : table réservée au service_role.

-- Restreindre les colonnes lisibles côté client pour ne jamais exposer les jetons.
REVOKE SELECT ON public.google_connections FROM authenticated;
GRANT SELECT (id, user_id, email, provider, connected_at, status, scope, expires_at)
  ON public.google_connections TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.google_connections TO authenticated;
GRANT ALL ON public.google_connections TO service_role;
