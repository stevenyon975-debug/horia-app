
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  first_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Auto-create profile trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'last_name'
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- Schedule events
CREATE TABLE public.schedule_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  location TEXT,
  notes TEXT,
  source TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_events TO authenticated;
GRANT ALL ON public.schedule_events TO service_role;
ALTER TABLE public.schedule_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own events select" ON public.schedule_events FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own events insert" ON public.schedule_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own events update" ON public.schedule_events FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own events delete" ON public.schedule_events FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER schedule_events_updated BEFORE UPDATE ON public.schedule_events FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX schedule_events_user_starts ON public.schedule_events(user_id, starts_at);

-- Payslips
CREATE TABLE public.payslips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  gross_amount NUMERIC,
  net_amount NUMERIC,
  file_path TEXT,
  summary TEXT,
  anomalies JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payslips TO authenticated;
GRANT ALL ON public.payslips TO service_role;
ALTER TABLE public.payslips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own payslips select" ON public.payslips FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own payslips insert" ON public.payslips FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own payslips update" ON public.payslips FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own payslips delete" ON public.payslips FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Documents (vault)
CREATE TABLE public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  file_path TEXT,
  size_bytes BIGINT,
  mime_type TEXT,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own docs select" ON public.documents FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own docs insert" ON public.documents FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own docs update" ON public.documents FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own docs delete" ON public.documents FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Email summaries
CREATE TABLE public.email_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  sender TEXT,
  summary TEXT,
  action_required BOOLEAN DEFAULT false,
  suggested_reply TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_summaries TO authenticated;
GRANT ALL ON public.email_summaries TO service_role;
ALTER TABLE public.email_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own emails select" ON public.email_summaries FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own emails insert" ON public.email_summaries FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own emails update" ON public.email_summaries FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own emails delete" ON public.email_summaries FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Per-user folder access on private buckets: planning-pdfs, payslips, documents
-- Convention: object name starts with "<auth.uid()>/..."

CREATE POLICY "horia own files select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id IN ('planning-pdfs','payslips','documents')
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "horia own files insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('planning-pdfs','payslips','documents')
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "horia own files update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id IN ('planning-pdfs','payslips','documents')
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "horia own files delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('planning-pdfs','payslips','documents')
  AND auth.uid()::text = (storage.foldername(name))[1]
);
CREATE TABLE public.plannings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  file_path text NOT NULL,
  size_bytes bigint,
  mime_type text,
  status text NOT NULL DEFAULT 'uploaded',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plannings TO authenticated;
GRANT ALL ON public.plannings TO service_role;

ALTER TABLE public.plannings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own plannings select" ON public.plannings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own plannings insert" ON public.plannings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own plannings update" ON public.plannings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own plannings delete" ON public.plannings FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER plannings_touch_updated_at
BEFORE UPDATE ON public.plannings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_plannings_user_created ON public.plannings(user_id, created_at DESC);ALTER TABLE public.plannings
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS page_count integer;

ALTER TABLE public.plannings ALTER COLUMN status SET DEFAULT 'pending';-- Add full_name to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;

-- Create shifts table
CREATE TABLE IF NOT EXISTS public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  planning_id uuid NOT NULL REFERENCES public.plannings(id) ON DELETE CASCADE,
  shift_date date,
  start_time time,
  end_time time,
  activity text,
  notes text,
  confidence text NOT NULL DEFAULT 'high', -- high | low
  raw_line text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own shifts select" ON public.shifts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own shifts insert" ON public.shifts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own shifts update" ON public.shifts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own shifts delete" ON public.shifts FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS shifts_planning_idx ON public.shifts(planning_id);
CREATE INDEX IF NOT EXISTS shifts_user_date_idx ON public.shifts(user_id, shift_date);

ALTER TABLE public.plannings
  ADD COLUMN IF NOT EXISTS ai_raw_json jsonb,
  ADD COLUMN IF NOT EXISTS ai_status text,
  ADD COLUMN IF NOT EXISTS ai_error_message text,
  ADD COLUMN IF NOT EXISTS planning_type text,
  ADD COLUMN IF NOT EXISTS selected_employee jsonb;

CREATE TABLE IF NOT EXISTS public.planning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planning_id uuid NOT NULL REFERENCES public.plannings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  shift_date date,
  start_time time,
  end_time time,
  activity text,
  location text,
  status text,
  raw_text text,
  warnings jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.planning_events TO authenticated;
GRANT ALL ON public.planning_events TO service_role;

ALTER TABLE public.planning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own planning_events select" ON public.planning_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own planning_events insert" ON public.planning_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own planning_events update" ON public.planning_events
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own planning_events delete" ON public.planning_events
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS planning_events_planning_id_idx ON public.planning_events(planning_id);
CREATE INDEX IF NOT EXISTS planning_events_user_id_idx ON public.planning_events(user_id);

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

ALTER TABLE public.google_connections DROP CONSTRAINT IF EXISTS google_connections_user_id_connector_id_key;
ALTER TABLE public.google_connections DROP COLUMN IF EXISTS connector_id;
ALTER TABLE public.google_connections DROP COLUMN IF EXISTS connection_id;
ALTER TABLE public.google_connections DROP COLUMN IF EXISTS scopes;

ALTER TABLE public.google_connections ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.google_connections ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'google';
ALTER TABLE public.google_connections ADD COLUMN IF NOT EXISTS connected_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.google_connections ADD CONSTRAINT google_connections_user_provider_unique UNIQUE (user_id, provider);

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
ALTER TABLE public.shifts ADD COLUMN google_event_id text;
CREATE INDEX IF NOT EXISTS shifts_google_event_id_idx ON public.shifts(google_event_id);ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS professional_email text;
CREATE INDEX IF NOT EXISTS profiles_professional_email_idx ON public.profiles (lower(professional_email));