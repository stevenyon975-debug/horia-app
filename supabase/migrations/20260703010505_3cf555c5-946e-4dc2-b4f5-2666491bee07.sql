ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS professional_email text;
CREATE INDEX IF NOT EXISTS profiles_professional_email_idx ON public.profiles (lower(professional_email));