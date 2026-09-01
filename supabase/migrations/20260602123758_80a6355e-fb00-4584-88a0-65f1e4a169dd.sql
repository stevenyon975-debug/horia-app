ALTER TABLE public.plannings
  ADD COLUMN IF NOT EXISTS extracted_text text,
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS page_count integer;

ALTER TABLE public.plannings ALTER COLUMN status SET DEFAULT 'pending';