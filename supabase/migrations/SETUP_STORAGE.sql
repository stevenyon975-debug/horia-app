-- Créer les buckets de stockage (à exécuter AVANT les migrations)
-- Ces commandes nécessitent un accès service_role

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('planning-pdfs', 'planning-pdfs', false, 52428800, ARRAY['application/pdf']),
  ('payslips', 'payslips', false, 52428800, ARRAY['application/pdf']),
  ('documents', 'documents', false, 52428800, NULL)
ON CONFLICT (id) DO NOTHING;
