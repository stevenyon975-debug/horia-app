import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractText, getDocumentProxy } from "unpdf";

export const extractPlanningText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    console.log(`[extractPlanningText] start id=${data.id} user=${userId}`);

    const { data: planning, error: fetchErr } = await supabase
      .from("plannings")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (fetchErr || !planning) {
      const msg = `Planning introuvable: ${fetchErr?.message ?? "no row"}`;
      console.error(`[extractPlanningText] ${msg}`);
      throw new Error(msg);
    }

    await supabase
      .from("plannings")
      .update({ status: "processing", error_message: null })
      .eq("id", data.id);

    try {
      console.log(`[extractPlanningText] downloading ${planning.file_path}`);
      const { data: file, error: dlErr } = await supabase.storage
        .from("planning-pdfs")
        .download(planning.file_path);
      if (dlErr || !file) {
        throw new Error(`Téléchargement impossible: ${dlErr?.message ?? "fichier vide"}`);
      }

      const arrayBuffer = await file.arrayBuffer();
      if (!arrayBuffer.byteLength) throw new Error("Le PDF téléchargé est vide (0 octet).");
      const buffer = new Uint8Array(arrayBuffer);
      console.log(`[extractPlanningText] downloaded ${buffer.byteLength} bytes`);

      const pdf = await getDocumentProxy(buffer);
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      const fullText = Array.isArray(text) ? text.join("\n\n") : text;
      console.log(`[extractPlanningText] extracted ${fullText.length} chars over ${totalPages} pages`);

      await supabase
        .from("plannings")
        .update({
          status: "completed",
          extracted_text: fullText,
          page_count: totalPages,
          error_message: null,
        })
        .eq("id", data.id);

      return { ok: true, pageCount: totalPages, length: fullText.length };
    } catch (e: any) {
      const message = e?.message ?? "Échec de l'extraction";
      console.error(`[extractPlanningText] FAILED id=${data.id}:`, e);
      await supabase
        .from("plannings")
        .update({ status: "failed", error_message: message })
        .eq("id", data.id);
      throw new Error(message);
    }
  });
