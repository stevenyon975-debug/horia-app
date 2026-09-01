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

CREATE INDEX idx_plannings_user_created ON public.plannings(user_id, created_at DESC);