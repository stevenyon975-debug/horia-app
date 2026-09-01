
CREATE TABLE public.google_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connector_id text NOT NULL,
  connection_id text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, connector_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_connections TO authenticated;
GRANT ALL ON public.google_connections TO service_role;

ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own google_connections select" ON public.google_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own google_connections insert" ON public.google_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own google_connections update" ON public.google_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own google_connections delete" ON public.google_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER touch_google_connections_updated_at
BEFORE UPDATE ON public.google_connections
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
