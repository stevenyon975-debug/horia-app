// Supabase Edge Function: analyze-planning-pdf
// Receives { planningId, filePath }, fetches the PDF from Storage,
// sends it to OpenAI for structured planning extraction, and returns JSON.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Bump this when you change the system prompt to bypass any caching layer.
const PROMPT_VERSION = "2026-06-17-v11-generic-no-hardcoded-week";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SYSTEM_PROMPT = `Tu es un assistant spécialisé dans l'extraction de plannings de travail à partir de documents PDF (radio/TV : MIX, MIXAGE, JT, JT Soir, MAT, OPS, FAB, Radio, Antenne, Maintenance, Réunion, RTT, JNT, RH, etc.).

RÈGLES STRICTES :

1. DÉTECTION DES EMPLOYÉS ET CIBLE DYNAMIQUE
   - Détecte tous les employés du document dans "employees_detected".
   - NE JAMAIS considérer les en-têtes comme des employés. En-têtes interdits : "Nom", "Nb", "OTT", "Nom Nb OTT", "Prénom".
   - Les employés apparaissent sous la forme NOM (majuscules) + Prénom (ligne suivante ou même ligne), parfois suivis d'un total horaire.
   - Le nom complet du salarié CIBLE t'est fourni dans le message utilisateur sous la forme : TARGET_EMPLOYEE = "<nom complet>".
   - Tu DOIS rechercher ce salarié dans le PDF en acceptant TOUTES les variantes suivantes :
       • ordre inversé : "Prénom Nom" ↔ "NOM Prénom" (ex. "Flavie Bry" ↔ "BRY Flavie")
       • casse indifférente (majuscules / minuscules / mixte)
       • accents et diacritiques ignorés ("Hélène" = "HELENE" = "helene")
       • espaces multiples, tabulations et sauts de ligne entre prénom et nom équivalents à un seul espace
       • tirets et apostrophes équivalents à un espace ("Jean-Pierre" = "Jean Pierre", "D'Amato" = "D Amato")
       • particules optionnelles ("de", "du", "le", "la") tolérées
       • prénoms composés et noms composés tolérés dans n'importe quel ordre
   - Compare en NORMALISANT (minuscules + suppression diacritiques + espace unique) la liste des employés détectés avec TARGET_EMPLOYEE.
   - Si une correspondance est trouvée → selected_employee = libellé EXACT tel qu'il apparaît dans le PDF (ne pas reformuler) et extrais UNIQUEMENT les événements de SA ligne dans "events".
   - Si aucune correspondance n'est trouvée → selected_employee = null, events = [] et ajoute un warning "Salarié <TARGET_EMPLOYEE> non trouvé dans le PDF".
   - INTERDIT de chercher un autre nom codé en dur. Seul TARGET_EMPLOYEE compte.

2. EXTRACTION DES DATES (CRITIQUE)
   - Les dates DOIVENT être déduites de l'en-tête du planning, ex. "Semaine 23 du 01/06/26 au 07/06/26".
   - Construis le mapping exact des 7 jours à partir de la date de début (format JJ/MM/AA → 20AA) :
       Lundi    = jour 1 de la plage
       Mardi    = jour 2
       Mercredi = jour 3
       Jeudi    = jour 4
       Vendredi = jour 5
       Samedi   = jour 6
       Dimanche = jour 7
     Exemple : "du 01/06/26 au 07/06/26" → Lundi=2026-06-01, Mardi=2026-06-02, Mercredi=2026-06-03, Jeudi=2026-06-04, Vendredi=2026-06-05, Samedi=2026-06-06, Dimanche=2026-06-07.
   - Format de sortie OBLIGATOIRE : ISO "YYYY-MM-DD".
   - NE JAMAIS inventer ni décaler une date. Si la plage de l'en-tête est incertaine (illisible, ambiguë, absente) → date = null et ajoute un warning explicite.

3. FIDÉLITÉ ABSOLUE DU TEXTE DES TÂCHES
   - "activity" DOIT être STRICTEMENT identique au texte du PDF (mêmes caractères, casse, abréviations, accents, espaces).
   - INTERDIT de reformuler, traduire, développer, normaliser ou corriger.
   - INTERDIT de remplacer "MIX" par "Mixage", "JT" par "Journal Télévisé", "MAT" par "Matin", etc. Aucune substitution abréviation ↔ forme longue.

4. SÉPARATION HORAIRE / ACTIVITÉ
   - "activity" contient UNIQUEMENT le texte exact de la tâche, SANS l'horaire.
   - "raw_text" contient la ligne complète exacte telle qu'écrite dans le PDF (horaire + activité).
   - "start_time" et "end_time" au format "HH:MM" (24h). Convertis "09h30" → "09:30", "13h00" → "13:00".
   - Exemple attendu :
     { "date": "2026-06-01", "start_time": "09:30", "end_time": "13:00",
       "activity": "01_Antenne Radio / Matin",
       "raw_text": "09h30-13h00 01_Antenne Radio / Matin" }

5. JOURS / ACTIVITÉS SANS HORAIRE (RÈGLE CRITIQUE — NE JAMAIS IGNORER)
   - TOUTE activité présente dans la cellule de l'employé sélectionné DOIT produire un événement dans "events", MÊME s'il n'y a NI heure de début NI heure de fin.
   - Cela inclut SANS EXCEPTION :
       • les codes d'absence / statut : "RTT EMPLOYEUR", "RTT", "JNT", "RH", "CP", "FORMATION", etc.
       • les activités de type forfait jour / rédaction sans horaire : "WEB / NUM", "JT SOIR / PRESENTATEUR JT", "RADIO INFO / REPORTAGE", "PLATEAUX / TOURNAGE", "RADIO / MATINALE", "DESK", "EDITING", etc.
       • toute autre mention textuelle figurant dans une cellule jour de l'employé.
   - Format obligatoire pour ces événements :
       { "date": "<date de la colonne>", "start_time": null, "end_time": null,
         "all_day": true,
         "activity": "<texte EXACT du PDF>",
         "raw_text": "<texte EXACT du PDF>",
         "event_type": "absence" si code statut (RH/RTT/JNT/RTT EMPLOYEUR/CP), sinon "shift",
         "confidence": "high" }
   - INTERDIT ABSOLU de retourner "events": [] quand l'employé sélectionné a des cellules non vides. Si la ligne contient du texte → il DOIT y avoir des events correspondants.
   - INTERDIT de transformer, traduire, abréger ou développer ces textes (pas de "Repos Hebdomadaire" pour "RH", pas de "Web / Numérique" pour "WEB / NUM", etc.).
   - Si un de ces libellés apparaît AVEC un horaire explicite, traite-le comme un événement horaire normal (all_day = false, event_type = "shift").
   - Pour tous les événements horaires (avec heures) : all_day = false, event_type = "shift", confidence = "high".

6. ALIGNEMENT STRICT COLONNE ↔ DATE (ANTI-DÉCALAGE — CRITIQUE)
   - Le planning est une grille : 1 ligne par employé, 7 colonnes (Lundi → Dimanche).
    - Chaque cellule de la ligne de l'employé traité (employé cible pour "events", n'importe quel employé pour "service_events") appartient EXCLUSIVEMENT à la date de SA colonne.
   - INTERDIT ABSOLU de faire glisser un créneau vers le jour précédent ou suivant, MÊME si :
       • le texte dépasse visuellement sur la colonne voisine,
       • l'horaire ressemble à celui d'un autre jour,
       • la cellule du jour voisin est vide,
       • l'ordre de lecture du PDF brouille les colonnes.
   - Pour CHAQUE créneau, avant d'émettre l'événement, identifie d'abord la COLONNE (jour de la semaine) à laquelle la cellule appartient visuellement, puis applique la date correspondante issue du mapping de la règle 2.
   - Si une cellule contient PLUSIEURS créneaux (ex. 09:00-12:00, 14:00-15:30, 15:30-20:00), TOUS ces créneaux gardent la MÊME date (celle de la colonne).
   - Si une cellule contient un code "JNT", "RH", "RTT EMPLOYEUR" SEUL, ce code reste sur la date EXACTE de sa colonne (jamais reporté sur le jour d'avant/d'après).
   - Si tu hésites entre deux colonnes pour un créneau, mets date = null et ajoute un warning explicite ("ambiguïté colonne lundi/mardi sur '...'"). NE DEVINE PAS.
   - Vérifie ton extraction en relisant colonne par colonne : pour chaque jour de Lundi à Dimanche, liste mentalement les créneaux de cette colonne uniquement.

7. INCERTITUDES
   - Si une information est incertaine (activité ambiguë, horaire illisible, date douteuse) :
     - mets le champ concerné à null,
     - garde le texte brut exact dans "raw_text",
     - ajoute un message explicite dans "warnings".
   - NE JAMAIS inventer une activité, un horaire ou une date.

8. PLANNING DU SERVICE (service_events) — SOURCE DE VÉRITÉ, ISOLATION STRICTE CELLULE PAR CELLULE
   - Construis "service_events" EN PREMIER. C'est la source de vérité complète du tableau PDF.
   - "service_events" DOIT contenir TOUS les événements de TOUS les employés détectés, y compris le salarié cible / selected_employee. INTERDIT d'exclure selected_employee au motif qu'il est déjà dans "events".
   - Après seulement, construis "events" comme la projection/filtre de "service_events" pour selected_employee : mêmes cellules, mêmes dates, mêmes raw_text, mêmes activity, sans décalage ni fusion.
   - Applique TOUTES les règles 2 à 7, en particulier la règle 6 (alignement colonne ↔ date) AVEC LA MÊME RIGUEUR que pour l'employé cible.
   - MÉTHODE OBLIGATOIRE pour service_events : traite le tableau CELLULE PAR CELLULE.
     Pour CHAQUE salarié (ligne) ET CHAQUE jour de la semaine (colonne) :
       a) Identifie visuellement la cellule à l'intersection (ligne salarié × colonne jour).
       b) Lis UNIQUEMENT le contenu de cette cellule.
        c) Si la cellule est non vide (activité, absence, statut, horaire, texte partiel), ÉMETS une ou plusieurs entrées correspondantes avec employee = nom EXACT de la ligne ET date = date EXACTE de la colonne.
       d) Passe à la cellule suivante.
   - INTERDIT d'ignorer silencieusement une cellule non vide. Si tu es incertain sur le contenu d'une cellule non vide : crée quand même une entrée service_events avec raw_text = texte brut visible, confidence = "low", les champs incertains à null, et ajoute un warning explicite avec salarié + jour/date.
   - INTERDIT ABSOLU :
       • déplacer une absence (JNT, RH, RTT, RTT EMPLOYEUR, RTT SALARIÉ, RÉCUPÉRATION SALARIÉ, CP, etc.) vers le jour précédent ou suivant ;
       • déplacer une absence ou un créneau vers un autre salarié (autre ligne) ;
       • reporter des créneaux horaires d'un jour vers un jour voisin contenant uniquement une absence ;
        • fusionner ou dédupliquer des cellules adjacentes ;
        • omettre selected_employee de service_events.
   - Si une cellule contient UNIQUEMENT une absence (JNT/RH/RTT/...), émets UNIQUEMENT cette absence pour ce salarié à cette date. N'y ajoute aucun créneau provenant d'une autre cellule.
   - Si une cellule contient des horaires, émets UNIQUEMENT ces créneaux pour ce salarié à cette date.
   - RÈGLE GÉNÉRALE ANTI-FUSION : si deux jours consécutifs contiennent chacun un statut court différent (ex. JNT un jour, RH le jour suivant), ils DOIVENT produire deux entrées service_events séparées, une par jour, avec sa propre date. INTERDIT de fusionner deux statuts de jours différents en une seule activité du type "JNT RH".
   - RÈGLE GÉNÉRALE COLONNE DIMANCHE : pour CHAQUE salarié détecté, relis explicitement la cellule de la colonne Dimanche (7e jour) et émets une entrée service_events si elle est non vide. Si l'activité exacte est incertaine, n'omets pas la cellule : crée une entrée avec raw_text brut, confidence "low", et ajoute un warning explicite mentionnant le salarié concerné.
   - CONTRÔLE GÉNÉRAL : si deux codes d'absence consécutifs apparaissent visuellement dans deux colonnes adjacentes, ils DOIVENT être deux événements distincts avec deux dates distinctes. Ne concatène jamais deux cellules d'absence en une seule activity.
   - Chaque entrée service_events doit inclure "employee" = libellé EXACT du salarié tel qu'il apparaît dans le PDF (ne pas reformuler, ne pas inverser).
   - Vérification finale : pour chaque (salarié, jour), relis la cellule du PDF et confirme que les events émis correspondent strictement à son contenu, sans rien d'une cellule voisine. Si une cellule non vide n'a pas d'entrée, corrige avant de répondre ou ajoute un warning si elle est illisible.
    - "events" ne contient TOUJOURS que les événements de l'employé cible, mais ils doivent provenir des mêmes cellules/dates que les entrées correspondantes dans "service_events".

9. ASSIGNATION STRICTE PAR POSITION X DE COLONNE (ANTI-DÉCALAGE GÉNÉRAL — CRITIQUE)
   - Le tableau du PDF est une grille rigide : 7 colonnes Lundi → Dimanche, chacune à une position horizontale (X) FIXE et identique pour TOUTES les lignes salariés.
   - Pour chaque ligne salarié, l'assignation d'une cellule à un jour se fait UNIQUEMENT d'après la position horizontale (X) de la cellule dans la grille, JAMAIS d'après l'ordre des cellules non vides dans la ligne.
   - INTERDIT ABSOLU :
       • compacter la ligne en remplissant les jours de gauche à droite et en ignorant les cellules vides ;
       • décaler, réordonner ou déplacer une cellule d'une colonne à une autre ;
       • repousser les statuts courts (JNT, RH, RTT, RTT EMPLOYEUR, RTT SALARIÉ, RÉCUPÉRATION SALARIÉ, RECUPERATION SALARIE, CP, ABS, MALADIE, FORMATION, CONGES, etc.) vers la fin de la ligne ou vers la dernière cellule disponible ;
       • fusionner plusieurs statuts courts dans une seule cellule ;
       • déplacer un contenu long pour combler une cellule de statut court voisine ;
       • supposer qu'un statut court "vient toujours en fin de semaine" — il peut apparaître n'importe quel jour, y compris en milieu de semaine.
   - Les statuts COURTS (JNT, RH, RTT, RTT EMPLOYEUR, RTT SALARIÉ, RÉCUPÉRATION SALARIÉ, CP, ABS, MALADIE, FORMATION, CONGES) sont des CONTENUS DE CELLULE À PART ENTIÈRE et doivent rester STRICTEMENT dans leur colonne d'origine, même quand ils apparaissent au milieu d'une ligne entourés de cellules à contenu long.
   - Les cellules vides DOIVENT rester vides : ne jamais y reporter le contenu d'une cellule voisine.
   - PROCÉDURE OBLIGATOIRE par ligne salarié : pour chaque jour de Lundi à Dimanche dans l'ordre, identifie la cellule à la position X de cette colonne, lis SON contenu (vide ou non), et émets l'entrée correspondante. Ne jamais traiter "les cellules non vides" comme une liste à redistribuer.
    - RÈGLE GÉNÉRALE ANTI-DÉPLACEMENT DE STATUT COURT : un statut court (JNT, RH, RTT, CP, etc.) doit toujours rester sur le jour exact où il apparaît visuellement dans le PDF, qu'il soit en milieu de semaine ou en fin de semaine. INTERDIT de déplacer un JNT ou RH observé en milieu de semaine (lundi à vendredi) vers le samedi ou le dimanche, ou inversement.
   - VÉRIFICATION FINALE par ligne : recompte les 7 cellules dans l'ordre Lun→Dim et confirme que chacune correspond à sa colonne X réelle dans le PDF. Si tu hésites, mets date = null et ajoute un warning ("ambiguïté colonne X sur ligne <salarié>") plutôt que de deviner.

10. COLONNE DIMANCHE (ANTI-CONTAMINATION CRITIQUE)
   - La colonne Dimanche (7e colonne, position X la plus à droite) DOIT être traitée EXACTEMENT comme les 6 autres jours : lecture indépendante de la cellule à la position X réelle de la colonne Dimanche pour CHAQUE salarié, individuellement.
   - INTERDIT ABSOLU :
       • copier le contenu (statut court ou activité) d'un salarié vers la cellule Dimanche d'un AUTRE salarié, même si plusieurs salariés ont RH/JNT/RTT le même dimanche ;
       • remplacer une cellule Dimanche contenant des horaires ou une activité longue par un statut court (RH, JNT, RTT, CP, etc.) provenant d'une autre ligne ou d'une autre zone du PDF ;
       • assumer qu'un dimanche est "par défaut RH" — chaque cellule Dimanche doit être lue indépendamment ;
       • propager un statut court Dimanche d'un salarié vers tous les autres salariés.
   - Pour CHAQUE salarié, lis la cellule située à l'intersection (ligne salarié × colonne Dimanche) et émets STRICTEMENT son contenu réel (horaires, activité longue, ou statut court, ou vide).
    - RÈGLE GÉNÉRALE ANTI-SUBSTITUTION DIMANCHE : ne jamais remplacer le contenu réel de la cellule Dimanche d'un salarié par un statut court (RH, JNT, etc.) si le PDF montre explicitement des horaires ou une activité longue à cet endroit. Le fait qu'un autre salarié ait RH ce même dimanche ne doit jamais influencer la lecture de la cellule d'un salarié différent : chaque cellule Dimanche est lue indépendamment, salarié par salarié.


Réponds UNIQUEMENT avec un JSON valide respectant ce schéma :
{
  "planning_type": string | null,
  "employees_detected": string[],
  "selected_employee": string | null,
  "events": [
    {
      "date": string | null,
      "start_time": string | null,
      "end_time": string | null,
      "all_day": boolean,
      "activity": string | null,
      "raw_text": string,
      "event_type": "shift" | "absence",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "service_events": [
    {
      "employee": string,
      "date": string | null,
      "start_time": string | null,
      "end_time": string | null,
      "all_day": boolean,
      "activity": string | null,
      "raw_text": string,
      "event_type": "shift" | "absence",
      "confidence": "high" | "medium" | "low"
    }
  ],
  "warnings": string[]
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { planningId, filePath, userFullName: providedName } = body ?? {};

    console.log("[analyze-planning-pdf] invoked", { planningId, filePath, providedName: providedName ?? null, promptVersion: PROMPT_VERSION });

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

    // Resolve target employee name from request, or fall back to the connected user's profile.
    let targetEmployee: string | null = typeof providedName === "string" && providedName.trim()
      ? providedName.trim()
      : null;

    if (!targetEmployee) {
      const authHeader = req.headers.get("Authorization") ?? "";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      if (token) {
        const { data: userData } = await supabase.auth.getUser(token);
        const uid = userData?.user?.id;
        if (uid) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("full_name, first_name, last_name")
            .eq("id", uid)
            .maybeSingle();
          const fullName =
            (profile?.full_name?.trim?.() as string | undefined) ||
            [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
          if (fullName) targetEmployee = fullName;
        }
      }
    }

    if (!targetEmployee) {
      return json(
        { ok: false, error: "Nom complet utilisateur manquant. Renseignez-le dans votre profil." },
        400,
      );
    }

    console.log("[analyze-planning-pdf] target employee resolved", { targetEmployee });

    // 1. Download the PDF from Storage
    const { data: fileData, error: dlError } = await supabase.storage
      .from("planning-pdfs")
      .download(filePath);

    if (dlError || !fileData) {
      console.error("[analyze-planning-pdf] storage download error", dlError);
      return json(
        { ok: false, error: `Storage download failed: ${dlError?.message}` },
        500,
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = base64Encode(new Uint8Array(arrayBuffer));
    const dataUrl = `data:application/pdf;base64,${base64}`;
    const fileName = filePath.split("/").pop() || "planning.pdf";

    console.log("[analyze-planning-pdf] pdf downloaded", {
      bytes: arrayBuffer.byteLength,
      fileName,
    });

    // 2. Call OpenAI with the PDF as an input_file
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
                  `TARGET_EMPLOYEE = "${targetEmployee}"\n\n` +
                  "Analyse ce planning PDF et retourne le JSON structuré demandé. " +
                  "Recherche TARGET_EMPLOYEE dans le PDF en appliquant strictement la règle 1 " +
                  "(ordre Prénom/Nom inversable, casse, accents, espaces et tirets équivalents). " +
                  "Extrais TOUS les événements de sa ligne dans \"events\" (y compris all_day=true). " +
                  "En PLUS, applique la règle 8 et remplis \"service_events\" avec TOUS les événements de TOUS les employés détectés (chaque entrée doit inclure \"employee\").",
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
      console.error("[analyze-planning-pdf] openai error", openaiResp.status, errText);
      return json(
        { ok: false, error: `OpenAI error ${openaiResp.status}`, details: errText },
        500,
      );
    }

    const openaiJson = await openaiResp.json();

    // Extract the text output from the Responses API
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
      console.error("[analyze-planning-pdf] JSON parse failed", e, outputText);
      return json(
        {
          ok: false,
          error: "Failed to parse OpenAI JSON response",
          raw: outputText,
        },
        500,
      );
    }

    // V1 simple : désactivation de la normalisation post-IA des service_events.
    // La fonction reste définie plus bas mais n'est plus appelée — on conserve
    // strictement la sortie brute de l'IA pour le planning du service.
    // normalizeServiceEventsCellIsolation(parsed);

    console.log("[analyze-planning-pdf] success", {
      employees: parsed?.employees_detected?.length,
      events: parsed?.events?.length,
      service_events: parsed?.service_events?.length,
    });

    // === DIAGNOSTIC V1 (lecture seule) : grille brute salarié × jour ===
    try {
      const SHORT_TOKENS = ["JNT", "RH", "RTT", "CP", "RTT_EMPLOYEUR", "RTT EMPLOYEUR", "RTT SALARIE", "RTT SALARIÉ"];
      const svc = Array.isArray(parsed?.service_events) ? parsed.service_events : [];
      const evts = Array.isArray(parsed?.events) ? parsed.events : [];

      const allDates = new Set<string>();
      const allEmployees = new Set<string>();
      for (const e of svc) {
        if (e?.date) allDates.add(e.date);
        if (e?.employee) allEmployees.add(e.employee);
      }
      const dates = Array.from(allDates).sort();
      const employees = Array.from(allEmployees).sort();

      console.log("[diag] dates_detected", dates);
      console.log("[diag] employees_detected", employees);

      for (const emp of employees) {
        const row: Record<string, string> = {};
        const shortCells: string[] = [];
        const emptyCols: string[] = [];
        for (const d of dates) {
          const cells = svc.filter((e: any) => e.employee === emp && e.date === d);
          if (cells.length === 0) {
            row[d] = "(vide)";
            emptyCols.push(d);
            continue;
          }
          const texts = cells.map((c: any) => c.raw_text ?? c.activity ?? "").filter(Boolean);
          const joined = texts.join(" | ");
          row[d] = joined || "(vide)";
          for (const t of texts) {
            const up = String(t).toUpperCase().trim();
            if (SHORT_TOKENS.some((tok) => up === tok)) shortCells.push(`${d}=${up}`);
          }
        }
        console.log(`[diag] row ${emp}`, JSON.stringify(row));
        if (shortCells.length) console.log(`[diag] short_cells ${emp}`, shortCells);
        if (emptyCols.length) console.log(`[diag] empty_cols ${emp}`, emptyCols);
      }

      // Comparaison events (planning personnel) vs service_events pour le salarié cible
      const targetEvtsByDate: Record<string, string[]> = {};
      for (const e of evts) {
        if (!e?.date) continue;
        (targetEvtsByDate[e.date] ||= []).push(e.raw_text ?? e.activity ?? "");
      }
      console.log("[diag] target_events_by_date", JSON.stringify(targetEvtsByDate));
    } catch (diagErr) {
      console.error("[diag] failed", diagErr);
    }
    // === FIN DIAGNOSTIC V1 ===

    return json({ ok: true, planningId, result: parsed });
  } catch (err) {
    console.error("[analyze-planning-pdf] unhandled error", err);
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

function normalizeServiceEventsCellIsolation(parsed: any) {
  if (!Array.isArray(parsed?.service_events)) return;

  const absenceTokens = [
    "RTT EMPLOYEUR",
    "RTT SALARIÉ",
    "RTT SALARIE",
    "RÉCUPÉRATION SALARIÉ",
    "RECUPERATION SALARIE",
    "JNT",
    "RH",
    "RTT",
    "CP",
  ];

  const normalized: any[] = [];
  for (const event of parsed.service_events) {
    const activity = typeof event?.activity === "string" ? event.activity.trim() : "";
    const pieces = splitAbsenceOnlyActivity(activity, absenceTokens);
    if (
      pieces.length > 1 &&
      typeof event?.date === "string" &&
      !event?.start_time &&
      !event?.end_time
    ) {
      for (let i = 0; i < pieces.length; i += 1) {
        normalized.push({
          ...event,
          date: addDaysIso(event.date, i),
          all_day: true,
          activity: pieces[i],
          raw_text: pieces[i],
          event_type: "absence",
        });
      }
    } else {
      normalized.push(event);
    }
  }

  parsed.service_events = normalized;
}

function splitAbsenceOnlyActivity(activity: string, absenceTokens: string[]): string[] {
  if (!activity) return [];
  const upper = activity.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let remaining = upper.replace(/[+/,;|]+/g, " ").replace(/\s+/g, " ").trim();
  const pieces: string[] = [];

  while (remaining) {
    const match = absenceTokens.find((token) => {
      const normalizedToken = token.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return remaining === normalizedToken || remaining.startsWith(`${normalizedToken} `);
    });
    if (!match) return [];
    pieces.push(match);
    remaining = remaining.slice(match.length).trim();
  }

  return pieces;
}

function addDaysIso(isoDate: string, days: number): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
