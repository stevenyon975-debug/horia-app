
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
