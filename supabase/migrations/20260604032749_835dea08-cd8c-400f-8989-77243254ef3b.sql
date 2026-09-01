ALTER TABLE public.shifts ADD COLUMN google_event_id text;
CREATE INDEX IF NOT EXISTS shifts_google_event_id_idx ON public.shifts(google_event_id);