-- Add full_name to profiles
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
