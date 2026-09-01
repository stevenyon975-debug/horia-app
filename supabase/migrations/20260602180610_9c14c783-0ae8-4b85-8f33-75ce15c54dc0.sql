
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
