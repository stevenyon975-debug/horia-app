// Supabase Edge Function: analyze-redaction-pdf
// Pipeline DÉDIÉ aux plannings rédaction / journalistes (REDACTION, JRI,
// ENCADREMENT REDACTION). N'IMPACTE PAS le pipeline OPS (FAB RÉGIE SON).
//
// V1 BRUT :
//   - détecter toutes les pages
//   - détecter toutes les sections
//   - détecter tous les salariés visibles
//   - reconstruire une grille brute salarié × jour
//   - conserver UNIQUEMENT le texte exact des cellules
//   - aucune normalisation, aucune correction, aucune invention

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const PROMPT_VERSION = "redaction-v1-brut-2026-06-10";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SYSTEM_PROMPT = `Tu es un extracteur BRUT de plannings rédaction / journalistes (France Télévisions, profils JRI, FJ, ENCADREMENT REDACTION, REDACTEURS, etc.).

OBJECTIF UNIQUE : reconstruire FIDÈLEMENT le tableau salarié × jour tel qu'il apparaît dans le PDF, SANS aucune transformation.

RÈGLES STRICTES (NE JAMAIS LES VIOLER) :

1. ANALYSE DE TOUTES LES PAGES
   - Lis et analyse TOUTES les pages du PDF.
   - Les plannings rédaction font souvent plusieurs pages : ne t'arrête pas à la première.

2. DÉTECTION DES SECTIONS
   - Détecte tous les en-têtes de section visibles (ex. "ENCADREMENT REDACTION", "REDACTEURS", "JRI", "PRODUCTION", "WEB", etc.).
   - Liste-les TELS QUELS dans "sections_detected".

3. DÉTECTION DES SALARIÉS
   - Détecte TOUS les salariés/journalistes visibles sur TOUTES les pages, dans TOUTES les sections.
   - Un salarié peut être écrit en "NOM Prénom" ou "Prénom NOM" ou même "NOM\\nPrénom" (sur 2 lignes).
   - Conserve le libellé EXACT du PDF, sans inversion, sans reformulation, sans correction de casse, sans suppression d'accents.
   - INTERDIT de considérer comme salarié : "Nom", "Nb", "OTT", "REDACTION", "JRI", "ENCADREMENT REDACTION", "Total", "Semaine", "Période", ou tout autre en-tête de tableau ou de section.
   - Si un nom est ambigu (illisible, en-tête possible), ne l'inclus PAS dans "employees_detected" et ajoute une entrée dans "ignored_candidates" avec { text, reason }.

4. GRILLE BRUTE SALARIÉ × JOUR
   - Identifie les 7 colonnes jour (Lundi → Dimanche) à partir de l'en-tête du tableau et de la plage de dates ("du JJ/MM/AA au JJ/MM/AA").
   - Pour CHAQUE salarié et CHAQUE jour, lis la cellule à l'intersection exacte (ligne × colonne).
   - "raw_text" = texte EXACT de la cellule, tel qu'écrit dans le PDF, sans aucune modification :
       • aucune normalisation
       • aucune correction
       • aucun développement d'abréviation (NE PAS remplacer "JRI" par "Journaliste Reporter d'Images", etc.)
       • aucune invention
       • aucune fusion de cellules adjacentes
       • aucun déplacement de contenu vers une cellule voisine
   - Si la cellule est vide → raw_text = "" (chaîne vide) ET empty = true.
   - Si la cellule contient plusieurs lignes, conserve les retours à la ligne avec "\\n".
   - INTERDIT ABSOLU de deviner, compléter ou reformuler.




5. ALIGNEMENT COLONNE
   - Chaque cellule appartient EXCLUSIVEMENT à la date de SA colonne (position X dans le tableau).
   - INTERDIT de décaler une cellule vers le jour précédent ou suivant, même si le texte déborde visuellement.
   - Les cellules vides DOIVENT rester vides.


6. ABSENCES / STATUTS / TÂCHES SANS HORAIRE
   - Conserve TEL QUEL le texte : "JNT", "RH", "RTT", "FORMATION", "VOYAGE", "WEB / NUM", "DESK", "REPORTAGE", etc.
   - INTERDIT de transformer "RH" en "Repos Hebdomadaire", "JNT" en "Journée Non Travaillée", etc.

7. DATES
   - Déduis les 7 dates depuis l'en-tête "Semaine N du JJ/MM/AA au JJ/MM/AA".
   - Format ISO obligatoire "YYYY-MM-DD".
   - Si la plage est introuvable → dates = [] et ajoute un warning explicite.

8. DIAGNOSTIC LECTURE SEULE
   - Remplis "diagnostic" avec :
       • pages_analyzed : nombre de pages PDF analysées
       • sections_detected : liste des sections
       • employees_total : nombre total de salariés détectés
       • empty_cells : nombre de cellules vides dans la grille
       • short_cells : nombre de cellules dont raw_text fait 1 ou 2 caractères
       • ignored_candidates : liste { text, reason } des libellés rejetés comme salarié ambigu
   - INTERDIT d'inventer ces chiffres : ils doivent refléter le contenu réel de la grille.

9. AUCUNE NORMALISATION POST-EXTRACTION
   - Ne génère PAS de champ "events" ni "service_events" avec horaires fusionnés.
   - "events" et "service_events" doivent TOUJOURS être des tableaux VIDES dans cette V1 brute.
   - Le seul livrable est "raw_grid" + "diagnostic" + "warnings".

Réponds UNIQUEMENT avec un JSON valide respectant ce schéma EXACT :
{
  "pipeline": "redaction",
  "planning_type": "redaction",
  "week_range": { "start": string | null, "end": string | null },
  "dates": string[],
  "sections_detected": string[],
  "employees_detected": string[],
  "raw_grid": {
    "dates": string[],
    "employees": string[],
    "cells": [
      {
        "employee": string,
        "date": string | null,
        "day_index": number,
        "raw_text": string,
        "empty": boolean,
        "short": boolean,
        "page": number,
        "section": string | null
      }
    ]
  },
  "diagnostic": {
    "pages_analyzed": number,
    "sections_detected": string[],
    "employees_total": number,
    "empty_cells": number,
    "short_cells": number,
    "ignored_candidates": [{ "text": string, "reason": string }]
  },
  "events": [],
  "service_events": [],
  "warnings": string[]
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { planningId, filePath } = body ?? {};

    console.log("[analyze-redaction-pdf] invoked", {
      planningId,
      filePath,
      promptVersion: PROMPT_VERSION,
    });

    if (!filePath) {
      return json({ ok: false, error: "Missing filePath" }, 400);
    }

    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return json({ ok: false, error: "OPENAI_API_KEY not configured" }, 500);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: fileData, error: dlError } = await supabase.storage
      .from("planning-pdfs")
      .download(filePath);

    if (dlError || !fileData) {
      console.error("[analyze-redaction-pdf] storage download error", dlError);
      return json(
        { ok: false, error: `Storage download failed: ${dlError?.message}` },
        500,
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = base64Encode(new Uint8Array(arrayBuffer));
    const dataUrl = `data:application/pdf;base64,${base64}`;
    const fileName = filePath.split("/").pop() || "planning-redaction.pdf";

    console.log("[analyze-redaction-pdf] pdf downloaded", {
      bytes: arrayBuffer.byteLength,
      fileName,
    });

    const openaiResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: SYSTEM_PROMPT }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Pipeline RÉDACTION (V1 brut). Analyse TOUTES les pages du PDF rédaction joint, " +
                  "détecte TOUTES les sections, TOUS les salariés/journalistes visibles, et reconstruis la grille brute " +
                  "salarié × jour en conservant STRICTEMENT le texte exact de chaque cellule (aucune normalisation, " +
                  "aucune correction, aucune invention, aucun développement d'abréviation). " +
                  "Renvoie le JSON exact demandé, avec events=[] et service_events=[].",
              },
              {
                type: "input_file",
                filename: fileName,
                file_data: dataUrl,
              },
            ],
          },
        ],
        text: { format: { type: "json_object" } },
      }),
    });

    if (!openaiResp.ok) {
      const errText = await openaiResp.text();
      console.error(
        "[analyze-redaction-pdf] openai error",
        openaiResp.status,
        errText,
      );
      return json(
        {
          ok: false,
          error: `OpenAI error ${openaiResp.status}`,
          details: errText,
        },
        500,
      );
    }

    const openaiJson = await openaiResp.json();

    let outputText = "";
    if (typeof openaiJson.output_text === "string" && openaiJson.output_text) {
      outputText = openaiJson.output_text;
    } else if (Array.isArray(openaiJson.output)) {
      for (const item of openaiJson.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" && typeof c.text === "string") {
              outputText += c.text;
            }
          }
        }
      }
    }

    let parsed: any = null;
    try {
      parsed = JSON.parse(outputText);
    } catch (e) {
      console.error("[analyze-redaction-pdf] JSON parse failed", e, outputText);
      return json(
        {
          ok: false,
          error: "Failed to parse OpenAI JSON response",
          raw: outputText,
        },
        500,
      );
    }

    // Forçage V1 BRUT : on garantit que ces champs restent vides quoi qu'il
    // arrive (anti-régression pipeline OPS / personnel / Google Calendar).
    parsed.pipeline = "redaction";
    parsed.planning_type = "redaction";
    parsed.events = [];
    parsed.service_events = [];

    console.log("[analyze-redaction-pdf] success", {
      pages_analyzed: parsed?.diagnostic?.pages_analyzed,
      employees_total: parsed?.diagnostic?.employees_total,
      sections: parsed?.sections_detected?.length,
      empty_cells: parsed?.diagnostic?.empty_cells,
      short_cells: parsed?.diagnostic?.short_cells,
    });

    if (Array.isArray(parsed?.employees_detected)) {
      console.log(
        "[analyze-redaction-pdf] employees_detected",
        parsed.employees_detected,
      );
    }

    return json({ ok: true, planningId, result: parsed });
  } catch (err) {
    console.error("[analyze-redaction-pdf] unhandled error", err);
    return json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
