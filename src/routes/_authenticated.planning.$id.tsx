import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  Copy,
  UserCheck,
  AlertTriangle,
  Microscope,
  CheckCircle2,
  XCircle,
  Brain,
  CalendarPlus,
  RotateCcw,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { extractPlanningText } from "@/lib/planning.functions";
import { extractShiftsForPlanning, diagnosePlanning, type DiagnosticPage } from "@/lib/shifts.functions";
import { syncShiftsToGoogleCalendar, resetGoogleSync } from "@/lib/google-oauth.functions";
import { PersonalPlanningView } from "@/components/PersonalPlanningView";
import { WeekSummaryView } from "@/components/WeekSummaryView";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/planning/$id")({
  head: () => ({ meta: [{ title: "Analyse du planning — HorIA" }] }),
  component: PlanningAnalysisPage,
});

type Planning = {
  id: string;
  file_name: string;
  file_path?: string | null;
  status: string;
  extracted_text: string | null;
  error_message: string | null;
  page_count: number | null;
  created_at: string;
  ai_status: string | null;
  ai_error_message: string | null;
  ai_raw_json: any | null;
  planning_type: string | null;
  selected_employee: any | null;
};

type Shift = {
  id: string;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  activity: string | null;
  notes: string | null;
  confidence: string;
  raw_line: string | null;
};

type AiEvent = {
  id: string;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  activity: string | null;
  location: string | null;
  status: string | null;
  raw_text: string | null;
};

type EdgeShiftEvent = {
  date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  activity?: string | null;
  raw_text?: string | null;
  confidence?: string | null;
};

function fmtTime(t: string | null) {
  if (!t) return "—";
  return t.slice(0, 5);
}
function fmtDate(d: string | null) {
  if (!d) return "—";
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return d;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month) return d;
  const days = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const months = [
    "janv.", "févr.", "mars", "avr.", "mai", "juin",
    "juil.", "août", "sept.", "oct.", "nov.", "déc.",
  ];
  return `${days[date.getUTCDay()]} ${String(day).padStart(2, "0")} ${months[month]}`;
}

function getEdgeShiftEvents(aiRawJson: any): EdgeShiftEvent[] {
  const payload = aiRawJson?.result ?? aiRawJson;
  if (!Array.isArray(payload?.events)) return [];
  return payload.events.filter((event: unknown): event is EdgeShiftEvent => Boolean(event) && typeof event === "object");
}

// Détection du type de planning à partir du texte extrait du PDF.
// - OPS (FAB RÉGIE SON, RADIO)      → pipeline déterministe dédié.
// - REDACTION / JRI / RÉDACTEURS    → pipeline rédaction dédié (V1 brut).
// Par défaut → ops_other (comportement LLM existant).
function detectPlanningPipeline(extractedText: string | null | undefined): "ops_son" | "ops_other" | "redaction" {
  const text = (extractedText ?? "").toString();
  if (!text) return "ops_other";
  // Rédaction testé en premier : ses marqueurs (RÉDACTEURS, JRI, etc.) sont
  // très spécifiques et ne se confondent jamais avec un PDF OPS — mais
  // certains PDFs de Rédaction contiennent le mot "RADIO" ailleurs dans le
  // texte (titre de section "TV RADIO WEB", activité "RADIO INFO"), donc on
  // doit écarter Rédaction avant de chercher les mots-clés OPS/Radio.
  if (/(ENCADREMENT\s+R[ÉE]DACTION|R[ÉE]DACTEURS?|R[ÉE]DACTION|\bJRI\b)/i.test(text)) {
    return "redaction";
  }
  // Pipeline déterministe dédié (validé S24/S25 pour Fab régie son, étendu
  // au service Radio qui partage exactement le même format de tableau avec
  // horaires précis). D'autres services à horaires précis (Fab régie vidéo,
  // Prise de vue, Monteurs, Scripte, Infographie) pourront être ajoutés ici
  // de la même façon, un mot-clé à la fois, une fois testés.
  if (/FAB\s*R[ÉE]GIE\s*(SON|VID[ÉE]O)|\bRADIO\b|\bSCRIPTE\b|\bMONTEURS\b|PRISE\s+DE\s+VUE|\bCDD\b|\bINFOGRAPHIE\b/i.test(text)) return "ops_son";
  return "ops_other";
}

function PlanningAnalysisPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState<Planning | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [aiEvents, setAiEvents] = useState<AiEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [extractingShifts, setExtractingShifts] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResponse, setAiResponse] = useState<any>(null);
  const [diagnostic, setDiagnostic] = useState<{ fullName: string; pages: DiagnosticPage[] } | null>(null);
  const extractFn = useServerFn(extractPlanningText);
  const extractShiftsFn = useServerFn(extractShiftsForPlanning);
  const diagnoseFn = useServerFn(diagnosePlanning);
  const syncGoogleFn = useServerFn(syncShiftsToGoogleCalendar);
  const resetSyncFn = useServerFn(resetGoogleSync);
  const [syncingGoogle, setSyncingGoogle] = useState(false);
  const [resettingGoogle, setResettingGoogle] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [lastSyncSample, setLastSyncSample] = useState<any>(null);
  const [showDiagReport, setShowDiagReport] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: sh }, { data: ev }] = await Promise.all([
      supabase
        .from("plannings")
        .select(
          "id, file_name, file_path, status, extracted_text, error_message, page_count, created_at, ai_status, ai_error_message, ai_raw_json, planning_type, selected_employee",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("shifts")
        .select("id, shift_date, start_time, end_time, activity, notes, confidence, raw_line")
        .eq("planning_id", id)
        .order("shift_date", { ascending: true, nullsFirst: false }),
      supabase
        .from("planning_events")
        .select("id, shift_date, start_time, end_time, activity, location, status, raw_text")
        .eq("planning_id", id)
        .order("shift_date", { ascending: true, nullsFirst: false }),
    ]);
    if (error) toast.error(error.message);
    setItem((data as Planning) ?? null);
    setShifts((sh as Shift[]) ?? []);
    setAiEvents((ev as AiEvent[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [id]);

  const runAi = async () => {
    setAiRunning(true);
    setAiResponse(null);
    try {
      console.log("[Analyse IA] invoking edge function", { planningId: id, filePath: item?.file_path });
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes.user?.id;
      let userFullName: string | null = null;
      if (uid) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, first_name, last_name")
          .eq("id", uid)
          .maybeSingle();
        userFullName =
          (profile?.full_name?.trim() as string | undefined) ||
          [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
          null;
      }
      const pipeline = detectPlanningPipeline(item?.extracted_text);
      console.log("[Analyse IA] pipeline détecté", { pipeline });

      let data: any;
      let error: any = null;

      if (pipeline === "redaction") {
        // Pipeline rédaction : extraction déterministe locale (sans LLM)
        try {
          const { data: file, error: dlErr } = await supabase.storage
            .from("planning-pdfs")
            .download((item as any)?.file_path ?? "");
          if (dlErr || !file) throw new Error(`Téléchargement PDF impossible: ${dlErr?.message ?? "fichier vide"}`);
          const { getDocumentProxy } = await import("unpdf");
          const buffer = new Uint8Array(await file.arrayBuffer());
          const pdf = await getDocumentProxy(buffer);
          const allCells: any[] = [];
          let allText = "";
          let weekStart: Date | null = null;
          for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            const items2 = (content.items as any[])
              .filter((it: any) => it.str?.trim())
              .map((it: any) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));
            allText += " " + items2.map((i: any) => i.str).join(" ");
            if (p === 1) {
              const m = allText.match(/du\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\s+au/i);
              if (m) {
                let y = parseInt(m[3], 10);
                if (y < 100) y += 2000;
                weekStart = new Date(Date.UTC(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
              }
            }
            const { buildRawGridFromPdf, extractGridLines } = await import("@/lib/shifts.functions");
            const gridLines = await extractGridLines(page);
            const cells = await buildRawGridFromPdf(items2, weekStart, gridLines);
            allCells.push(...cells);
          }
          const employees = [...new Set(allCells.map((c) => c.employee))];
          const dates = [...new Set(allCells.map((c) => c.date).filter(Boolean))].sort();
          const SERVICE_NAMES: { key: string; patterns: string[] }[] = [
            { key: "Rédaction", patterns: ["tds_re_daction", "redaction", "rédaction", "daction"] },
            { key: "Radio", patterns: ["07_radio", "radio"] },
            { key: "Scriptes", patterns: ["05_script", "scripte"] },
            { key: "Monteurs", patterns: ["04_monteur", "monteur"] },
            { key: "Prise de vue", patterns: ["02_prise", "prise de vue"] },
            { key: "Fab régie vidéo", patterns: ["01_fab_re_gie_vide", "fab régie vidéo", "fab regie video", "régie vidéo"] },
            { key: "Encadrement Technique", patterns: ["08_encad", "encadrement technique", "encad. technique"] },
            { key: "CDD", patterns: ["09_cdd", "5.cdd", "cdd"] },
            { key: "Direction", patterns: ["direction_s", "direction"] },
            { key: "Finance et gestion", patterns: ["finance_et_gestion", "finance et gestion"] },
            { key: "Organisation d'activités", patterns: ["organisation_d_activite", "organisation activite"] },
            { key: "Prog Prod Radio TV", patterns: ["prog_prod", "prog prod"] },
            { key: "Animatrices CDI", patterns: ["animatrices_cdi", "animatrices cdi"] },
            { key: "Infographie", patterns: ["06_infographie", "infographie"] },
            { key: "Fab régie son", patterns: ["03_fab_re_gie_son", "fab régie son", "fab regie son"] },
          ];
          const fileNameLower = ((item as any)?.file_name ?? "").toLowerCase();
          const textLower = allText.toLowerCase();
          // Priorité 1 : match sur le nom de fichier (plus fiable)
          let matched = SERVICE_NAMES.find(s => s.patterns.some(p => fileNameLower.includes(p)));
          // Priorité 2 : match sur le texte uniquement si pas trouvé dans le nom de fichier
          if (!matched) {
            matched = SERVICE_NAMES.find(s => s.patterns.some(p => textLower.includes(p)));
          }
          const serviceName = matched?.key ?? null;
          // Pour la Rédaction (FJ), pas d'horaires — events "all_day" depuis le texte brut.
          const redactionServiceEvents = allCells
            .filter((c: any) => !c.empty && c.raw_text?.trim())
            .map((c: any) => ({
              employee: c.employee,
              date: c.date,
              raw_text: c.raw_text,
              all_day: true,
            }));
          data = {
            ok: true,
            result: {
              pipeline: "redaction",
              planning_type: "redaction",
              service_name: serviceName,
              week_range: { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null },
              dates,
              employees_detected: employees,
              raw_grid: { dates, employees, cells: allCells },
              events: [],
              service_events: redactionServiceEvents,
              warnings: [],
            },
          };
        } catch (e: any) {
          error = e;
        }
      } else if (pipeline === "ops_son") {
        // Pipeline OPS Fab régie son : extraction déterministe locale (sans LLM),
        // même méthode que rédaction + service_events via parseCell pour le
        // calcul de cumul d'heures et l'affichage horaire dans Planning du service.
        try {
          const { data: file, error: dlErr } = await supabase.storage
            .from("planning-pdfs")
            .download((item as any)?.file_path ?? "");
          if (dlErr || !file) throw new Error(`Téléchargement PDF impossible: ${dlErr?.message ?? "fichier vide"}`);
          const { getDocumentProxy } = await import("unpdf");
          const buffer = new Uint8Array(await file.arrayBuffer());
          const pdf = await getDocumentProxy(buffer);
          const allCells: any[] = [];
          let allText = "";
          let weekStart: Date | null = null;
          for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            const items2 = (content.items as any[])
              .filter((it: any) => it.str?.trim())
              .map((it: any) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));
            allText += " " + items2.map((i: any) => i.str).join(" ");
            if (p === 1) {
              const m = allText.match(/du\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\s+au/i);
              if (m) {
                let y = parseInt(m[3], 10);
                if (y < 100) y += 2000;
                weekStart = new Date(Date.UTC(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
              }
            }
            const { buildRawGridFromPdf, extractGridLines } = await import("@/lib/shifts.functions");
            const gridLines = await extractGridLines(page);
            const cells = await buildRawGridFromPdf(items2, weekStart, gridLines);
            allCells.push(...cells);
          }
          const { buildServiceEventsFromCells } = await import("@/lib/shifts.functions");
          const serviceEvents = buildServiceEventsFromCells(allCells);
          const employees = [...new Set(allCells.map((c) => c.employee))];
          const dates = [...new Set(allCells.map((c) => c.date).filter(Boolean))].sort();
          const SERVICE_NAMES: { key: string; patterns: string[] }[] = [
            { key: "Rédaction", patterns: ["tds_re_daction", "redaction", "rédaction", "daction"] },
            { key: "Radio", patterns: ["07_radio", "radio"] },
            { key: "Scriptes", patterns: ["05_script", "scripte"] },
            { key: "Monteurs", patterns: ["04_monteur", "monteur"] },
            { key: "Prise de vue", patterns: ["02_prise", "prise de vue"] },
            { key: "Fab régie vidéo", patterns: ["01_fab_re_gie_vide", "fab régie vidéo", "fab regie video", "régie vidéo"] },
            { key: "Encadrement Technique", patterns: ["08_encad", "encadrement technique", "encad. technique"] },
            { key: "CDD", patterns: ["09_cdd", "5.cdd", "cdd"] },
            { key: "Direction", patterns: ["direction_s", "direction"] },
            { key: "Finance et gestion", patterns: ["finance_et_gestion", "finance et gestion"] },
            { key: "Organisation d'activités", patterns: ["organisation_d_activite", "organisation activite"] },
            { key: "Prog Prod Radio TV", patterns: ["prog_prod", "prog prod"] },
            { key: "Animatrices CDI", patterns: ["animatrices_cdi", "animatrices cdi"] },
            { key: "Infographie", patterns: ["06_infographie", "infographie"] },
            { key: "Fab régie son", patterns: ["03_fab_re_gie_son", "fab régie son", "fab regie son"] },
          ];
          const fileNameLower = ((item as any)?.file_name ?? "").toLowerCase();
          const textLower = allText.toLowerCase();
          // Priorité 1 : match sur le nom de fichier (plus fiable)
          let matched = SERVICE_NAMES.find(s => s.patterns.some(p => fileNameLower.includes(p)));
          // Priorité 2 : match sur le texte uniquement si pas trouvé dans le nom de fichier
          if (!matched) {
            matched = SERVICE_NAMES.find(s => s.patterns.some(p => textLower.includes(p)));
          }
          const serviceName = matched?.key ?? null;
          const targetNorm = (userFullName ?? "")
            .toString()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .split(/[\s,]+/)
            .filter(Boolean)
            .sort()
            .join(" ");
          const employeeEvents = serviceEvents.filter((e: any) => {
            const norm = (e.employee ?? "")
              .toString()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .split(/[\s,]+/)
              .filter(Boolean)
              .sort()
              .join(" ");
            return norm === targetNorm;
          });
          data = {
            ok: true,
            result: {
              pipeline: "ops_son",
              planning_type: "ops_son",
              service_name: serviceName,
              week_range: { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null },
              dates,
              employees_detected: employees,
              raw_grid: { dates, employees, cells: allCells },
              events: employeeEvents,
              service_events: serviceEvents,
              warnings: [],
            },
          };
        } catch (e: any) {
          error = e;
        }
      } else {
        try {
          const { data: file, error: dlErr } = await supabase.storage
            .from("planning-pdfs")
            .download((item as any)?.file_path ?? "");
          if (dlErr || !file) throw new Error(`Téléchargement PDF impossible: ${dlErr?.message ?? "fichier vide"}`);
          const { getDocumentProxy } = await import("unpdf");
          const buffer = new Uint8Array(await file.arrayBuffer());
          const pdf = await getDocumentProxy(buffer);
          const allCells: any[] = [];
          let allText = "";
          let weekStart: Date | null = null;
          for (let p = 1; p <= pdf.numPages; p++) {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            const items2 = (content.items as any[])
              .filter((it: any) => it.str?.trim())
              .map((it: any) => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));
            allText += " " + items2.map((i: any) => i.str).join(" ");
            if (p === 1) {
              const m = allText.match(/du\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\s+au/i);
              if (m) {
                let y = parseInt(m[3], 10);
                if (y < 100) y += 2000;
                weekStart = new Date(Date.UTC(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
              }
            }
            const { buildRawGridFromPdf, extractGridLines } = await import("@/lib/shifts.functions");
            const gridLines = await extractGridLines(page);
            const cells = await buildRawGridFromPdf(items2, weekStart, gridLines);
            allCells.push(...cells);
          }
          const { buildServiceEventsFromCells } = await import("@/lib/shifts.functions");
          const serviceEvents = buildServiceEventsFromCells(allCells);
          const employees = [...new Set(allCells.map((c) => c.employee))];
            const dates = [...new Set(allCells.map((c) => c.date).filter(Boolean))].sort();
            const SERVICE_NAMES: { key: string; patterns: string[] }[] = [
              { key: "Radio", patterns: ["07_radio", "radio"] },
              { key: "Scriptes", patterns: ["05_script", "scripte"] },
              { key: "Monteurs", patterns: ["04_monteur", "monteur"] },
              { key: "Prise de vue", patterns: ["02_prise", "prise de vue"] },
              { key: "Fab régie vidéo", patterns: ["01_fab_re_gie_vide", "fab régie vidéo", "fab regie video", "régie vidéo"] },
              { key: "Encadrement Technique", patterns: ["08_encad", "encadrement technique", "encad. technique"] },
              { key: "CDD", patterns: ["09_cdd", "5.cdd", "cdd"] },
              { key: "Direction", patterns: ["direction_s", "direction"] },
              { key: "Finance et gestion", patterns: ["finance_et_gestion", "finance et gestion"] },
              { key: "Organisation d'activités", patterns: ["organisation_d_activite", "organisation activite"] },
              { key: "Prog Prod Radio TV", patterns: ["prog_prod", "prog prod"] },
              { key: "Animatrices CDI", patterns: ["animatrices_cdi", "animatrices cdi"] },
              { key: "Infographie", patterns: ["06_infographie", "infographie"] },
              { key: "Fab régie son", patterns: ["03_fab_re_gie_son", "fab régie son", "fab regie son"] },
              { key: "Rédaction", patterns: ["tds_re_daction", "redaction", "rédaction"] },
            ];
            const fileNameLower = ((item as any)?.file_name ?? "").toLowerCase();
            const textLower = allText.toLowerCase();
            // Priorité 1 : match sur le nom de fichier (plus fiable)
            let matched = SERVICE_NAMES.find(s => s.patterns.some(p => fileNameLower.includes(p)));
            // Priorité 2 : match sur le texte uniquement si pas trouvé dans le nom de fichier
            if (!matched) {
              matched = SERVICE_NAMES.find(s => s.patterns.some(p => textLower.includes(p)));
            }
            const serviceName = matched?.key ?? null;
            const targetNorm = (userFullName ?? "")
            .toString()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .split(/[\s,]+/)
            .filter(Boolean)
            .sort()
            .join(" ");
          const employeeEvents = serviceEvents.filter((e: any) => {
            const norm = (e.employee ?? "")
              .toString()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .toLowerCase()
              .split(/[\s,]+/)
              .filter(Boolean)
              .sort()
              .join(" ");
            return norm === targetNorm;
          });
          data = {
            ok: true,
              result: {
                pipeline: "generic",
                planning_type: "generic",
                service_name: serviceName,
                week_range: { start: dates[0] ?? null, end: dates[dates.length - 1] ?? null },
              dates,
              employees_detected: employees,
              raw_grid: { dates, employees, cells: allCells },
              events: employeeEvents,
              service_events: serviceEvents,
              warnings: [],
            },
          };
        } catch (e: any) {
          error = e;
        }
      }
      if (error) throw new Error(error.message ?? String(error));
      console.log("[Analyse IA] response", data);
      setAiResponse(data);

      // Persist the AI result into plannings so extractShiftsForPlanning can read ai_raw_json
      if (data && data.ok === true) {
        const aiRawJson = data.result ?? data;
        const { error: updErr } = await supabase
          .from("plannings")
          .update({
            ai_raw_json: aiRawJson,
            ai_status: "completed",
            ai_error_message: null,
          })
          .eq("id", id);
        if (updErr) {
          console.error("[Analyse IA] persist error", updErr);
          toast.error(`Sauvegarde IA échouée: ${updErr.message}`);
        } else {
          toast.success("Analyse IA — résultat enregistré");
          await load();
          await extractShifts();
        }
      } else {
        const errMsg = data?.error ?? "Analyse IA échouée";
        await supabase
          .from("plannings")
          .update({ ai_status: "failed", ai_error_message: String(errMsg) })
          .eq("id", id);
        toast.error(String(errMsg));
        await load();
      }
    } catch (e: any) {
      console.error("[Analyse IA] error", e);
      setAiResponse({ error: e?.message ?? String(e) });
      await supabase
        .from("plannings")
        .update({ ai_status: "failed", ai_error_message: e?.message ?? String(e) })
        .eq("id", id);
      toast.error(e.message ?? "Échec de l'analyse IA");
    } finally {
      setAiRunning(false);
    }
  };


  const reanalyze = async () => {
    setAnalyzing(true);
    try {
      await extractFn({ data: { id } });
      toast.success("Analyse terminée");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Échec de l'analyse");
      await load();
    } finally {
      setAnalyzing(false);
    }
  };

  const extractShifts = async () => {
    setExtractingShifts(true);
    try {
      const res = await extractShiftsFn({ data: { planning_id: id } });
      toast.success(
        res.count
          ? `${res.count} shift${res.count > 1 ? "s" : ""} détecté${res.count > 1 ? "s" : ""}.`
          : `Aucun shift trouvé.`,
      );
      await load();
      navigate({ to: "/planning" });
    } catch (e: any) {
      toast.error(e.message ?? "Échec de l'extraction des shifts");
    } finally {
      setExtractingShifts(false);
    }
  };

  const runDiagnostic = async () => {
    setDiagnosing(true);
    try {
      const res = await diagnoseFn({ data: { planning_id: id } });
      setDiagnostic(res);
      const totalEmps = res.pages.reduce((a, p) => a + p.employees.length, 0);
      toast.success(`Diagnostic: ${totalEmps} employé(s) détecté(s) sur ${res.pages.length} page(s).`);
    } catch (e: any) {
      toast.error(e.message ?? "Échec du diagnostic");
    } finally {
      setDiagnosing(false);
    }
  };

  const copyText = async () => {
    if (!item?.extracted_text) return;
    await navigator.clipboard.writeText(item.extracted_text);
    toast.success("Texte copié");
  };

  const syncToGoogle = async () => {
    setSyncingGoogle(true);
    try {
      const res = (await syncGoogleFn({ data: { planning_id: id } })) as {
        created: number;
        alreadySynced: number;
        failed: number;
        errors: string[];
        firstSample: unknown;
      };
      console.log("[syncToGoogle] firstSample complete:\n" + JSON.stringify(res.firstSample, null, 2));
      setLastSyncSample(res.firstSample ?? null);
      setShowDiagReport(false);
      const summary = `${res.created} événement${res.created > 1 ? "s" : ""} créé${res.created > 1 ? "s" : ""}, ${res.alreadySynced} déjà synchronisé${res.alreadySynced > 1 ? "s" : ""}, ${res.failed} erreur${res.failed > 1 ? "s" : ""}`;
      if (res.failed === 0) {
        toast.success(summary);
      } else {
        toast.error(`${summary}. Détails : ${res.errors.slice(0, 3).join(" | ")}`);
        console.error("[syncToGoogle] errors", res.errors);
      }
    } catch (e: any) {
      console.error("[syncToGoogle] error", e);
      toast.error(e?.message ?? "Échec de la synchronisation Google Agenda");
    } finally {
      setSyncingGoogle(false);
    }
  };

  const handleResetSync = async () => {
    setResettingGoogle(true);
    setShowResetDialog(false);
    try {
      const res = (await resetSyncFn({ data: { planning_id: id } })) as { resetCount: number };
      toast.success(`${res.resetCount} shift${res.resetCount > 1 ? "s" : ""} réinitialisé${res.resetCount > 1 ? "s" : ""}. Vous pouvez maintenant resynchroniser vers Google Agenda.`);
      await load();
    } catch (e: any) {
      console.error("[resetSync] error", e);
      toast.error(e?.message ?? "Échec de la réinitialisation");
    } finally {
      setResettingGoogle(false);
    }
  };

  const liveEdgeShiftRows = getEdgeShiftEvents(aiResponse);
  const storedEdgeShiftRows = getEdgeShiftEvents(item?.ai_raw_json);
  const edgeShiftRows = liveEdgeShiftRows.length > 0 ? liveEdgeShiftRows : storedEdgeShiftRows;
  const mesShiftRows = edgeShiftRows.length > 0
    ? edgeShiftRows.map((event, index) => {
        const rawDate = event.date ?? null;
        const displayedDate = fmtDate(rawDate);
        console.log("shift date mapping", { rawDate, displayedDate });
        return {
          id: `edge-${index}-${rawDate ?? ""}-${event.start_time ?? ""}`,
          date: rawDate,
          start_time: event.start_time ?? null,
          end_time: event.end_time ?? null,
          activity: event.activity ?? null,
          confidence: event.confidence ?? null,
          raw_text: event.raw_text ?? null,
        };
      })
    : shifts.map((shift) => {
        const rawDate = shift.shift_date;
        const displayedDate = fmtDate(rawDate);
        console.log("shift date mapping", { rawDate, displayedDate });
        return {
          id: shift.id,
          date: rawDate,
          start_time: shift.start_time,
          end_time: shift.end_time,
          activity: shift.activity,
          confidence: shift.confidence,
          raw_text: shift.raw_line,
        };
      });

  return (
    <AppShell title="Analyse du planning">
      <div className="-mt-6 flex items-center gap-3">
        <Link to="/planning" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Retour aux plannings
        </Link>
      </div>

      {loading ? (
        <div className="mt-8 flex items-center justify-center p-10 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
        </div>
      ) : !item ? (
        <div className="mt-8 rounded-2xl border border-border/60 p-10 text-center text-sm text-muted-foreground">
          Planning introuvable.
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="mt-6">
            <div>
              <h2 className="font-display text-xl font-semibold">{item.file_name}</h2>
              <p className="text-xs text-muted-foreground">
                Statut : {item.status}
                {item.page_count ? ` · ${item.page_count} page${item.page_count > 1 ? "s" : ""}` : ""}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
              <h3 className="font-display text-lg font-semibold">Résumé de la semaine</h3>
            </div>
            <WeekSummaryView shifts={shifts} />
          </div>

          <div className="mt-6">
            <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
              <h3 className="font-display text-lg font-semibold">Mon planning</h3>
              <span className="text-xs text-muted-foreground">
                {shifts.length} shift{shifts.length > 1 ? "s" : ""}
              </span>
            </div>
            <PersonalPlanningView shifts={shifts} />
          </div>



          {/* Outils avancés */}
          <Accordion type="single" collapsible className="mt-6">
            <AccordionItem value="tools" className="rounded-2xl border border-border/60 px-4">
              <AccordionTrigger className="text-sm font-medium hover:no-underline">
                <span className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-muted-foreground" />
                  Outils avancés
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-4 pb-4">
                          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h2 className="font-display text-xl font-semibold">{item.file_name}</h2>
                              <p className="text-xs text-muted-foreground">
                                Statut : {item.status}
                                {item.page_count ? ` · ${item.page_count} page${item.page_count > 1 ? "s" : ""}` : ""}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                onClick={copyText}
                                disabled={!item.extracted_text}
                                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                              >
                                <Copy className="h-4 w-4" /> Copier
                              </button>
                              <button
                                onClick={reanalyze}
                                disabled={analyzing}
                                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                              >
                                {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                Relancer l'analyse
                              </button>
                              <button
                                onClick={runDiagnostic}
                                disabled={diagnosing || !item.extracted_text}
                                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                              >
                                {diagnosing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Microscope className="h-4 w-4" />}
                                Mode diagnostic
                              </button>
                              <button
                                onClick={extractShifts}
                                disabled={extractingShifts || !item.extracted_text}
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                                style={{ background: "var(--gradient-primary)" }}
                              >
                                {extractingShifts ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <UserCheck className="h-4 w-4" />
                                )}
                                Détecter mes shifts
                              </button>
                              <button
                                onClick={runAi}
                                disabled={aiRunning}
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                                style={{ background: "var(--gradient-primary)" }}
                              >
                                {aiRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
                                Analyse IA
                              </button>
                              <button
                                onClick={syncToGoogle}
                                disabled={syncingGoogle || shifts.length === 0}
                                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                                style={{ background: "var(--gradient-primary)" }}
                              >
                                {syncingGoogle ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
                                Synchroniser vers Google Agenda
                              </button>
                              <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
                                <AlertDialogTrigger asChild>
                                  <button
                                    disabled={resettingGoogle || shifts.length === 0}
                                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
                                  >
                                    {resettingGoogle ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                                    Réinitialiser la synchronisation Google
                                  </button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Réinitialiser la synchronisation ?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Cette action supprimera les liens de synchronisation Google Calendar de tous les shifts de ce planning. Les événements dans Google Calendar ne seront pas supprimés, mais les shifts seront considérés comme non synchronisés et pourront être recréés lors de la prochaine synchronisation.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel onClick={() => setShowResetDialog(false)}>Annuler</AlertDialogCancel>
                                    <AlertDialogAction onClick={handleResetSync} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                      Réinitialiser
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          {lastSyncSample && (
                            <div className="mt-4 rounded-xl border border-border/60 bg-muted/40 p-4">
                              <button
                                type="button"
                                onClick={() => setShowDiagReport((v) => !v)}
                                className="text-sm font-medium text-primary hover:underline"
                              >
                                {showDiagReport ? "Masquer le rapport diagnostic" : "Afficher le rapport diagnostic"}
                              </button>
                              {showDiagReport && (
                                <div className="mt-3 space-y-2 text-xs">
                                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                                    <div><span className="text-muted-foreground">horIA_date :</span> <span className="font-mono">{String(lastSyncSample.horIA_date)}</span></div>
                                    <div><span className="text-muted-foreground">timezone :</span> <span className="font-mono">{String(lastSyncSample.timezone)}</span></div>
                                    <div><span className="text-muted-foreground">horIA_start :</span> <span className="font-mono">{String(lastSyncSample.horIA_start)}</span></div>
                                    <div><span className="text-muted-foreground">horIA_end :</span> <span className="font-mono">{String(lastSyncSample.horIA_end)}</span></div>
                                    <div><span className="text-muted-foreground">googleStartDateTime :</span> <span className="font-mono">{String(lastSyncSample.googleStartDateTime)}</span></div>
                                    <div><span className="text-muted-foreground">googleEndDateTime :</span> <span className="font-mono">{String(lastSyncSample.googleEndDateTime)}</span></div>
                                  </div>
                                  <div>
                                    <div className="mb-1 text-muted-foreground">Payload JSON envoyé à Google Calendar :</div>
                                    <pre className="overflow-auto rounded-lg border border-border/60 bg-background p-3 text-[11px] leading-relaxed">
                {JSON.stringify(lastSyncSample.payload, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          </div>

                          {aiResponse && (
                            <div className="mt-4 rounded-xl border border-border/60 bg-muted/40 p-4">
                              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                <Brain className="h-3.5 w-3.5" /> Réponse Edge Function
                              </div>
                              <pre className="overflow-auto text-xs leading-relaxed text-foreground">
                {JSON.stringify(aiResponse, null, 2)}
                              </pre>
                            </div>
                          )}


                {item.status === "failed" && item.error_message && (
                  <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                    {item.error_message}
                  </div>
                )}

                {/* Diagnostic pipeline RÉDACTION (V1 brut, lecture seule). N'affecte ni OPS, ni planning personnel, ni Google Calendar. */}
                {item.ai_raw_json?.result?.pipeline === "redaction" || item.ai_raw_json?.pipeline === "redaction" ? (() => {
                  const r = item.ai_raw_json?.result ?? item.ai_raw_json;
                  const diag = r?.diagnostic ?? {};
                  const grid = r?.raw_grid ?? {};
                  const gridDates: string[] = Array.isArray(grid?.dates) ? grid.dates : [];
                  const gridEmployees: string[] = Array.isArray(grid?.employees) ? grid.employees : [];
                  const cells: any[] = Array.isArray(grid?.cells) ? grid.cells : [];
                  const cellMap = new Map<string, any>();
                  for (const c of cells) cellMap.set(`${c.employee}__${c.date ?? ""}`, c);
                  const ignored: any[] = Array.isArray(diag?.ignored_candidates) ? diag.ignored_candidates : [];
                  const sections: string[] = Array.isArray(r?.sections_detected) ? r.sections_detected : [];
                  return (
                    <div className="mt-6 rounded-2xl border border-border/60 p-5" style={{ background: "var(--gradient-surface)" }}>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-display text-lg font-semibold flex items-center gap-2">
                          <Microscope className="h-4 w-4" /> Diagnostic rédaction (V1 brut)
                        </h3>
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">pipeline: redaction</span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-4">
                        <div>Pages analysées : <span className="font-mono text-foreground">{diag?.pages_analyzed ?? "—"}</span></div>
                        <div>Salariés détectés : <span className="font-mono text-foreground">{diag?.employees_total ?? gridEmployees.length}</span></div>
                        <div>Cellules vides : <span className="font-mono text-foreground">{diag?.empty_cells ?? "—"}</span></div>
                        <div>Cellules courtes : <span className="font-mono text-foreground">{diag?.short_cells ?? "—"}</span></div>
                      </div>

                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sections détectées ({sections.length})</p>
                        {sections.length === 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">Aucune section détectée.</p>
                        ) : (
                          <ul className="mt-1 flex flex-wrap gap-1 text-xs">
                            {sections.map((s, i) => (
                              <li key={i} className="rounded-full bg-background/60 px-2 py-0.5 font-mono">{s}</li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Salariés détectés ({gridEmployees.length})
                        </p>
                        {gridEmployees.length === 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">Aucun salarié détecté.</p>
                        ) : (
                          <ul className="mt-1 grid grid-cols-1 gap-0.5 text-xs sm:grid-cols-2 md:grid-cols-3">
                            {gridEmployees.map((e, i) => (
                              <li key={i} className="font-mono">· {e}</li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {gridDates.length > 0 && gridEmployees.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Grille brute salarié × jour
                          </p>
                          <div className="mt-1 overflow-x-auto rounded-xl border border-border/40 bg-background/40">
                            <table className="w-full min-w-max text-[11px]">
                              <thead className="bg-background/60 text-muted-foreground">
                                <tr>
                                  <th className="sticky left-0 z-10 bg-background/80 px-2 py-1 text-left">Salarié</th>
                                  {gridDates.map((d) => (
                                    <th key={d} className="px-2 py-1 text-left font-mono whitespace-nowrap">{d}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {gridEmployees.map((emp) => (
                                  <tr key={emp} className="border-t border-border/30 align-top">
                                    <td className="sticky left-0 z-10 bg-background/80 px-2 py-1 font-mono whitespace-nowrap">{emp}</td>
                                    {gridDates.map((d) => {
                                      const c = cellMap.get(`${emp}__${d}`);
                                      const txt = c?.raw_text ?? "";
                                      const empty = !txt || c?.empty;
                                      return (
                                        <td key={d} className={`px-2 py-1 font-mono whitespace-pre-wrap ${empty ? "text-muted-foreground/60 italic" : ""}`}>
                                          {empty ? "(vide)" : txt}
                                        </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {ignored.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Candidats ignorés ({ignored.length})
                          </p>
                          <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto text-xs">
                            {ignored.map((c, i) => (
                              <li key={i} className="text-muted-foreground">
                                ✗ <span className="font-mono">{c?.text}</span>{" "}
                                <span className="text-[10px]">[{c?.reason}]</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {Array.isArray(r?.warnings) && r.warnings.length > 0 && (
                        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                          <p className="font-semibold uppercase tracking-wider text-amber-400">Avertissements</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4">
                            {r.warnings.map((w: string, i: number) => (<li key={i}>{w}</li>))}
                          </ul>
                        </div>
                      )}

                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          JSON brut rédaction
                        </summary>
                        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-background/60 p-3 text-[11px] leading-tight">
{JSON.stringify(r, null, 2)}
                        </pre>
                      </details>
                    </div>
                  );
                })() : null}

                          {(item.ai_status || aiEvents.length > 0 || item.ai_raw_json) && (
                            <div className="mt-6 rounded-2xl border border-border/60 p-5" style={{ background: "var(--gradient-surface)" }}>
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <h3 className="font-display text-lg font-semibold flex items-center gap-2">
                                  <Brain className="h-4 w-4" /> Analyse IA
                                </h3>
                                <div className="flex items-center gap-2 text-xs">
                                  {item.ai_status && (
                                    <span className={`rounded-full px-2 py-0.5 ${
                                      item.ai_status === "completed" ? "bg-emerald-500/15 text-emerald-400" :
                                      item.ai_status === "failed" ? "bg-destructive/15 text-destructive" :
                                      "bg-amber-500/15 text-amber-400"
                                    }`}>{item.ai_status}</span>
                                  )}
                                  {item.planning_type && (
                                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-primary">type: {item.planning_type}</span>
                                  )}
                                </div>
                              </div>

                              {item.ai_error_message && (
                                <p className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                                  {item.ai_error_message}
                                </p>
                              )}

                              {item.selected_employee && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Employé retenu :{" "}
                                  <span className="font-mono font-semibold text-foreground">
                                    {(item.selected_employee as any).full_name}
                                  </span>{" "}
                                  <span className="text-[10px]">
                                    (confiance {(item.selected_employee as any).confidence})
                                  </span>
                                </p>
                              )}

                              {Array.isArray(item.ai_raw_json?.warnings) && item.ai_raw_json.warnings.length > 0 && (
                                <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                                  <p className="font-semibold uppercase tracking-wider text-amber-400">Avertissements</p>
                                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                                    {item.ai_raw_json.warnings.map((w: string, i: number) => (
                                      <li key={i}>{w}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <div className="mt-4 overflow-x-auto">
                                <table className="w-full text-sm">
                                  <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
                                    <tr>
                                      <th className="px-3 py-2 text-left">Date</th>
                                      <th className="px-3 py-2 text-left">Début</th>
                                      <th className="px-3 py-2 text-left">Fin</th>
                                      <th className="px-3 py-2 text-left">Activité</th>
                                      <th className="px-3 py-2 text-left">Statut</th>
                                      <th className="px-3 py-2 text-left">Texte brut</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {aiEvents.length === 0 ? (
                                      <tr><td colSpan={6} className="px-3 py-4 text-center text-xs text-muted-foreground">Aucun événement IA.</td></tr>
                                    ) : aiEvents.map((e) => (
                                      <tr key={e.id} className="border-t border-border/40 align-top">
                                        <td className="px-3 py-2 font-medium whitespace-nowrap">{fmtDate(e.shift_date)}</td>
                                        <td className="px-3 py-2 font-mono">{fmtTime(e.start_time)}</td>
                                        <td className="px-3 py-2 font-mono">{fmtTime(e.end_time)}</td>
                                        <td className="px-3 py-2">{e.activity ?? "—"}</td>
                                        <td className="px-3 py-2">
                                          <span className={`rounded-full px-2 py-0.5 text-xs ${
                                            e.status === "confirmed" ? "bg-emerald-500/15 text-emerald-400" :
                                            e.status === "provisional" ? "bg-amber-500/15 text-amber-400" :
                                            "bg-muted text-muted-foreground"
                                          }`}>{e.status ?? "—"}</span>
                                        </td>
                                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground whitespace-pre-wrap">{e.raw_text ?? "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>

                              {item.ai_raw_json && (
                                <details className="mt-3">
                                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    JSON IA brut
                                  </summary>
                                  <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-background/60 p-3 text-[11px] leading-tight">
                {JSON.stringify(item.ai_raw_json, null, 2)}
                                  </pre>
                                </details>
                              )}
                            </div>
                          )}


                {diagnostic && (
                  <div className="mt-6 rounded-2xl border border-border/60 p-5" style={{ background: "var(--gradient-surface)" }}>
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-display text-lg font-semibold flex items-center gap-2">
                        <Microscope className="h-4 w-4" /> Diagnostic structure du tableau
                      </h3>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => {
                            const blob = new Blob([JSON.stringify(diagnostic, null, 2)], { type: "application/json" });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement("a");
                            a.href = url;
                            a.download = `diagnostic-${id}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                          }}
                          className="rounded-lg border border-border px-2.5 py-1 text-xs hover:bg-accent"
                        >
                          Exporter JSON
                        </button>
                        <button onClick={() => setDiagnostic(null)} className="text-xs text-muted-foreground hover:text-foreground">
                          Masquer
                        </button>
                      </div>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Nom recherché : <span className="font-mono">{diagnostic.fullName}</span>
                    </p>


                    {diagnostic.pages.map((p) => (
                      <div key={p.page} className="mt-4 rounded-xl border border-border/40 bg-background/40 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-sm font-semibold">
                            Page {p.page} {p.weekStart && <span className="ml-2 text-xs text-muted-foreground">(semaine du {p.weekStart})</span>}
                          </h4>
                          {p.matchedUser ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> Vous : {p.matchedUser}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-xs text-destructive">
                              <XCircle className="h-3 w-3" /> Non trouvé sur cette page
                            </span>
                          )}
                        </div>

                        {p.primaryEmployee && (
                          <div className="mt-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs">
                            <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                              {p.matchedUser === p.primaryEmployee ? "Extraction basée sur :" : "Candidat principal :"}
                            </span>{" "}
                            <span className="font-mono font-semibold text-primary">{p.primaryEmployee}</span>
                          </div>
                        )}



                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-4">
                          <div>Items: <span className="font-mono text-foreground">{p.totalItems}</span></div>
                          <div>Page: <span className="font-mono text-foreground">{p.pageWidth.toFixed(0)}×{p.pageHeight.toFixed(0)}</span></div>
                          <div>HeaderY: <span className="font-mono text-foreground">{p.headerY?.toFixed(0) ?? "—"}</span></div>
                          <div>1ʳᵉ col X: <span className="font-mono text-foreground">{p.firstColX?.toFixed(0) ?? "—"}</span></div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Colonnes jour ({p.dayColumns.length})
                            </p>
                            {p.dayColumns.length === 0 ? (
                              <p className="mt-1 text-xs text-muted-foreground">Aucune colonne détectée.</p>
                            ) : (
                              <ul className="mt-1 space-y-0.5 text-xs font-mono">
                                {p.dayColumns.map((c) => (
                                  <li key={`${p.page}-${c.dayIndex}`}>
                                    {["lun", "mar", "mer", "jeu", "ven", "sam", "dim"][c.dayIndex]} {c.date ?? "?"} — x:[{c.x.toFixed(0)} → {c.xEnd === -1 ? "∞" : c.xEnd.toFixed(0)}]
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Employés détectés ({p.employees.length})
                            </p>
                            {p.employees.length === 0 ? (
                              <p className="mt-1 text-xs text-muted-foreground">Aucun employé détecté.</p>
                            ) : (
                              <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto text-xs">
                                {p.employees.map((e, i) => (
                                  <li key={`${p.page}-emp-${i}`} className={e.isUser ? "font-semibold text-emerald-400" : ""}>
                                    {e.isUser ? "★ " : "· "}{e.name} <span className="font-mono text-muted-foreground">y:{e.yTop.toFixed(0)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Bandes de lignes (colonne gauche, {p.rowBands.length})
                            </p>
                            {p.rowBands.length === 0 ? (
                              <p className="mt-1 text-xs text-muted-foreground">Aucune ligne détectée dans la zone des noms.</p>
                            ) : (
                              <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto text-xs font-mono">
                                {p.rowBands.map((b, i) => (
                                  <li key={`${p.page}-rb-${i}`}>
                                    y:{b.y.toFixed(0)} ({b.itemCount}) — {b.sample}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Candidats noms ({p.leftCandidates.length})
                            </p>
                            {p.leftCandidates.length === 0 ? (
                              <p className="mt-1 text-xs text-muted-foreground">Aucun candidat.</p>
                            ) : (
                              <ul className="mt-1 max-h-48 space-y-0.5 overflow-auto text-xs">
                                {p.leftCandidates.map((c, i) => (
                                  <li
                                    key={`${p.page}-cand-${i}`}
                                    className={c.accepted ? "text-emerald-400" : "text-muted-foreground"}
                                  >
                                    {c.accepted ? "✓ " : "✗ "}
                                    <span className="font-mono">{c.text}</span>
                                    <span className="ml-1 text-[10px]">score={c.score} [{c.reason}]</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>

                        <details className="mt-3">
                          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Tous les blocs texte ({p.allItems.length})
                          </summary>
                          <div className="mt-2 max-h-64 overflow-auto rounded-lg bg-background/60 p-2 font-mono text-[10px] leading-tight">
                            {p.allItems.map((it, i) => (
                              <div key={`${p.page}-all-${i}`}>
                                x:{it.x.toFixed(0).padStart(4, " ")} y:{it.y.toFixed(0).padStart(4, " ")} — {it.str}
                              </div>
                            ))}
                          </div>
                        </details>


                        {p.cells.length > 0 && (
                          <div className="mt-3">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Cellules de votre ligne ({p.cells.length})
                            </p>
                            <div className="mt-1 overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="text-muted-foreground">
                                  <tr>
                                    <th className="px-2 py-1 text-left">Date</th>
                                    <th className="px-2 py-1 text-left">Bornes</th>
                                    <th className="px-2 py-1 text-left">Contenu brut</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.cells.map((c, i) => (
                                    <tr key={`${p.page}-c-${i}`} className="border-t border-border/30 align-top">
                                      <td className="px-2 py-1 whitespace-nowrap font-mono">{c.date ?? "?"}</td>
                                      <td className="px-2 py-1 whitespace-nowrap font-mono text-muted-foreground">
                                        x:[{c.x.toFixed(0)}→{c.xEnd === -1 ? "∞" : c.xEnd.toFixed(0)}] y:[{c.yBottom === -1 ? "−∞" : c.yBottom.toFixed(0)}→{c.yTop.toFixed(0)}]
                                      </td>
                                      <td className="px-2 py-1 font-mono whitespace-pre-wrap">{c.text}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Shifts table */}
                <div className="mt-6">
                  <h3 className="font-display text-lg font-semibold">Mes shifts</h3>
                  <p className="text-xs text-muted-foreground">
                    Renseignez votre <Link to="/profile" className="underline">nom complet</Link> dans votre profil, puis cliquez sur « Détecter mes shifts ».
                  </p>

                  <div
                    className="mt-3 overflow-hidden rounded-2xl border border-border/60"
                    style={{ background: "var(--gradient-surface)" }}
                  >
                    {mesShiftRows.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        Aucun shift détecté pour le moment.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-background/40 text-xs uppercase tracking-wider text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 text-left">Date</th>
                              <th className="px-3 py-2 text-left">Début</th>
                              <th className="px-3 py-2 text-left">Fin</th>
                              <th className="px-3 py-2 text-left">Activité</th>
                              <th className="px-3 py-2 text-left">Confiance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {mesShiftRows.map((s) => {
                              const conf = (s.confidence ?? "low") as "high" | "medium" | "low";
                              const confMap = {
                                high: { label: "Élevée", cls: "bg-emerald-500/15 text-emerald-400" },
                                medium: { label: "Moyenne", cls: "bg-amber-500/15 text-amber-400" },
                                low: { label: "Faible", cls: "bg-destructive/15 text-destructive" },
                              } as const;
                              const c = confMap[conf];
                              return (
                                <tr
                                  key={s.id}
                                  className={`border-t border-border/40 ${conf !== "high" ? "bg-amber-500/5" : ""}`}
                                  title={s.raw_text ?? ""}
                                >
                                  <td className="px-3 py-2 font-medium">
                                    <span className="inline-flex items-center gap-1">
                                      {conf !== "high" && <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />}
                                      {fmtDate(s.date)}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 font-mono">{fmtTime(s.start_time)}</td>
                                  <td className="px-3 py-2 font-mono">{fmtTime(s.end_time)}</td>
                                  <td className="px-3 py-2">{s.activity ?? "—"}</td>
                                  <td className="px-3 py-2">
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.cls}`}>
                                      {c.label}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="mt-6 rounded-2xl border border-border/60 p-6"
                  style={{ background: "var(--gradient-surface)" }}
                >
                  <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                    Texte extrait
                  </h3>
                  {item.extracted_text ? (
                    <pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-background/40 p-4 font-mono text-sm leading-relaxed">
                      {item.extracted_text}
                    </pre>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">
                      Aucun texte extrait pour le moment. Lancez l'analyse depuis la liste des plannings.
                    </p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </AppShell>
  );
}
