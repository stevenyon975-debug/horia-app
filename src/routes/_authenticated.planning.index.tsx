import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Upload, FileText, Loader2, Trash2, Download, Sparkles, Eye, CalendarDays, Files, Users, X, Building2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { extractPlanningText } from "@/lib/planning.functions";
import { extractShiftsForPlanning } from "@/lib/shifts.functions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { WeekSummaryView } from "@/components/WeekSummaryView";
import { PersonalPlanningView } from "@/components/PersonalPlanningView";
import { DayDetailView } from "@/components/DayDetailView";
import { ServicePlanningView } from "@/components/ServicePlanningView";
import { getTodayUTC, weekStartUTC } from "@/lib/utils";

// Détection du type de planning à partir du texte extrait du PDF.
// Copie volontairement locale de la même logique que dans
// _authenticated.planning.$id.tsx (pas de module partagé pour rester simple).
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

export const Route = createFileRoute("/_authenticated/planning/")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: (search.tab as string) ?? "me",
  }),
  head: () => ({ meta: [{ title: "Planning — HorIA" }] }),
  component: PlanningPage,
});

type Planning = {
  id: string;
  file_name: string;
  file_path: string;
  size_bytes: number | null;
  mime_type: string | null;
  status: string;
  page_count: number | null;
  error_message: string | null;
  created_at: string;
  ai_raw_json?: any | null;
};

type Shift = {
  id: string;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  activity: string | null;
  notes: string | null;
  confidence: string | null;
};

function formatSize(bytes: number | null) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "En attente", cls: "bg-muted text-muted-foreground" },
    uploaded: { label: "En attente", cls: "bg-muted text-muted-foreground" },
    processing: { label: "Analyse…", cls: "bg-amber-500/15 text-amber-400" },
    completed: { label: "Terminé", cls: "bg-emerald-500/15 text-emerald-400" },
    failed: { label: "Échec", cls: "bg-destructive/15 text-destructive" },
  };
  const v = map[status] ?? map.pending;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.cls}`}>{v.label}</span>;
}

function PlanningPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Planning[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [autoProgress, setAutoProgress] = useState<{ done: number; total: number } | null>(null);
  const autoQueueRef = useRef<string[]>([]);
  const autoProcessingRef = useRef(false);
  const autoSeenRef = useRef<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const extractFn = useServerFn(extractPlanningText);
  const extractShiftsFn = useServerFn(extractShiftsForPlanning);
  const navigate = useNavigate();
  const { tab: tabFromUrl } = Route.useSearch();
  const [activeTab, setActiveTab] = useState(tabFromUrl);
  useEffect(() => { setActiveTab(tabFromUrl); }, [tabFromUrl]);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [myFullName, setMyFullName] = useState<string | null>(null);
  const dayDetailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedDay && dayDetailRef.current) {
      dayDetailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [selectedDay]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("full_name, first_name, last_name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const name =
          (data.full_name?.trim() as string | undefined) ||
          [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
          null;
        setMyFullName(name);
      });
  }, [user]);

  const runFullPipeline = async (planningId: string) => {
    // 1. Extract PDF text
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const authHeaders = token ? { Authorization: `Bearer ${token}` } : undefined;

    await extractFn({ data: { id: planningId }, headers: authHeaders });

    // 2. AI analysis (edge function)
    const { data: planningRow } = await supabase
      .from("plannings")
      .select("file_path, file_name")
      .eq("id", planningId)
      .maybeSingle();

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

    const { data: extractedRow } = await supabase
      .from("plannings")
      .select("extracted_text")
      .eq("id", planningId)
      .maybeSingle();
    const pipeline = detectPlanningPipeline(extractedRow?.extracted_text ?? null);

    let aiData: any;
    let aiErr: any = null;

    if (pipeline === "ops_son") {
      // Pipeline OPS Fab régie son : extraction déterministe locale (sans LLM),
      // identique à celle de _authenticated.planning.$id.tsx (runAi).
      try {
        const { data: file, error: dlErr } = await supabase.storage
          .from("planning-pdfs")
          .download(planningRow?.file_path ?? "");
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
        const fileNameLower = (planningRow?.file_name ?? "").toLowerCase();
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
        aiData = {
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
        aiErr = e;
      }
    } else if (pipeline === "redaction") {
      // Pipeline rédaction : extraction déterministe locale (sans LLM),
      // identique à celle de _authenticated.planning.$id.tsx (runAi).
      try {
        const { data: file, error: dlErr } = await supabase.storage
          .from("planning-pdfs")
          .download(planningRow?.file_path ?? "");
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
        const fileNameLower = (planningRow?.file_name ?? "").toLowerCase();
        const textLower = allText.toLowerCase();
        // Priorité 1 : match sur le nom de fichier (plus fiable)
        let matched = SERVICE_NAMES.find(s => s.patterns.some(p => fileNameLower.includes(p)));
        // Priorité 2 : match sur le texte uniquement si pas trouvé dans le nom de fichier
        if (!matched) {
          matched = SERVICE_NAMES.find(s => s.patterns.some(p => textLower.includes(p)));
        }
        const serviceName = matched?.key ?? null;
        // Pour la Rédaction (FJ), les cellules n'ont pas d'horaires précis —
        // on crée des events "all_day" à partir du texte brut des cellules.
        const redactionServiceEvents = allCells
          .filter((c: any) => !c.empty && c.raw_text?.trim())
          .map((c: any) => ({
            employee: c.employee,
            date: c.date,
            raw_text: c.raw_text,
            all_day: true,
          }));
        aiData = {
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
        aiErr = e;
      }
    } else {
      try {
        const { data: file, error: dlErr } = await supabase.storage
          .from("planning-pdfs")
          .download(planningRow?.file_path ?? "");
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
          const fileNameLower = (planningRow?.file_name ?? "").toLowerCase();
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
        aiData = {
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
        aiErr = e;
      }
    }

    if (aiErr) throw new Error(aiErr.message ?? String(aiErr));
    if (aiData && aiData.ok === true) {
      const aiRawJson = aiData.result ?? aiData;
      await supabase
        .from("plannings")
        .update({ ai_raw_json: aiRawJson, ai_status: "completed", ai_error_message: null })
        .eq("id", planningId);
    } else {
      const errMsg = aiData?.error ?? "Analyse IA échouée";
      await supabase
        .from("plannings")
        .update({ ai_status: "failed", ai_error_message: String(errMsg) })
        .eq("id", planningId);
      throw new Error(String(errMsg));
    }


    // 3. Detect shifts
    await extractShiftsFn({ data: { planning_id: planningId }, headers: authHeaders });
  };

  const load = async () => {
    setLoading(true);
    const [{ data, error }, { data: sh, error: shErr }] = await Promise.all([
      supabase
        .from("plannings")
        .select("id, file_name, file_path, size_bytes, mime_type, status, page_count, error_message, created_at, ai_raw_json")
        .order("created_at", { ascending: false }),
      supabase
        .from("shifts")
        .select("id, shift_date, start_time, end_time, activity, notes, confidence")
        .order("shift_date", { ascending: true, nullsFirst: false }),
    ]);
    if (error) toast.error(error.message);
    if (shErr) toast.error(shErr.message);
    setItems((data ?? []) as Planning[]);
    setShifts((sh ?? []) as Shift[]);
    setLoading(false);
  };

  useEffect(() => {
    if (user) load();
  }, [user]);

  // File d'attente d'auto-analyse : consommée en séquence, alimentée à la
  // fois par le chargement initial et par les événements Realtime.
  const processAutoQueue = async () => {
    if (autoProcessingRef.current) return;
    if (autoQueueRef.current.length === 0) return;
    autoProcessingRef.current = true;
    let done = 0;
    const startTotal = autoQueueRef.current.length;
    setAutoProgress({ done: 0, total: startTotal });
    while (autoQueueRef.current.length > 0) {
      const id = autoQueueRef.current.shift()!;
      try {
        await runFullPipeline(id);
      } catch (e) {
        console.error("Auto-analyse échouée pour", id, e);
      }
      done += 1;
      const total = done + autoQueueRef.current.length;
      setAutoProgress({ done, total });
    }
    setAutoProgress(null);
    autoProcessingRef.current = false;
    await load();
  };

  const enqueueForAutoAnalysis = (ids: string[]) => {
    const fresh = ids.filter((id) => !autoSeenRef.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => autoSeenRef.current.add(id));
    autoQueueRef.current.push(...fresh);
    void processAutoQueue();
  };

  // Auto-analyse des plannings importés (par email notamment) restés en "pending"
  useEffect(() => {
    if (loading || !user) return;
    const pending = items.filter((i) => i.status === "pending").map((i) => i.id);
    if (pending.length === 0) return;
    enqueueForAutoAnalysis(pending);
  }, [loading, items, user]);

  // Realtime : détecte l'arrivée de nouveaux plannings en "pending"
  // (import par email pendant que la page est ouverte) et les ajoute
  // automatiquement à la file d'analyse.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("plannings-auto-analysis")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "plannings", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as Planning;
          if (row?.status !== "pending") return;
          setItems((prev) => (prev.some((p) => p.id === row.id) ? prev : [row, ...prev]));
          enqueueForAutoAnalysis([row.id]);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "plannings", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as Planning;
          if (row?.status !== "pending") return;
          enqueueForAutoAnalysis([row.id]);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || !files.length || !user) return;
    const file = files[0];
    if (file.type !== "application/pdf") {
      toast.error("Seuls les fichiers PDF sont acceptés.");
      return;
    }
    setUploading(true);
    try {
      // Ensure an authenticated session is attached to the Storage request.
      // Without a fresh access_token, Supabase Storage sends only the
      // publishable key and the RLS policy on storage.objects rejects the
      // upload because auth.uid() is null.
      let { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session?.access_token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        sessionData = { session: refreshed.session } as typeof sessionData;
      }
      if (!sessionData.session?.access_token) {
        toast.error("Session expirée, merci de vous reconnecter.");
        setUploading(false);
        return;
      }

      const path = `${user.id}/${crypto.randomUUID()}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("planning-pdfs")
        .upload(path, file, { contentType: "application/pdf" });
      if (upErr) throw upErr;

      const { data: inserted, error: dbErr } = await supabase
        .from("plannings")
        .insert({
          user_id: user.id,
          file_name: file.name,
          file_path: path,
          size_bytes: file.size,
          mime_type: file.type,
          status: "pending",
        })
        .select("id")
        .single();
      if (dbErr) throw dbErr;
      toast.success("Planning importé. Analyse en cours…");
      if (inputRef.current) inputRef.current.value = "";
      setUploading(false);

      const planningId = inserted.id as string;
      setAnalyzingId(planningId);
      try {
        await runFullPipeline(planningId);
        toast.success("Planning prêt !");
        await load();
        window.location.href = "/planning?tab=me";
      } catch (e: any) {
        const message = e?.message ?? "Échec du traitement automatique";
        console.error("[planning] auto pipeline failed", e);
        toast.error(message);
        await load();
      } finally {
        setAnalyzingId(null);
      }
      return;
    } catch (e: any) {
      toast.error(e.message ?? "Échec de l'import");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleAnalyze = async (item: Planning) => {
    setAnalyzingId(item.id);
    setItems((prev) =>
      prev.map((p) => (p.id === item.id ? { ...p, status: "processing", error_message: null } : p)),
    );
    try {
      await runFullPipeline(item.id);
      toast.success("Analyse terminée.");
      await load();
    } catch (e: any) {
      const message = e?.message ?? "Échec de l'analyse";
      console.error("[planning] analyze failed", e);
      toast.error(message);
      setItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: "failed", error_message: message } : p)),
      );
      await supabase
        .from("plannings")
        .update({ status: "failed", error_message: message })
        .eq("id", item.id);
    } finally {
      setAnalyzingId(null);
    }
  };

  const handleDelete = async (item: Planning) => {
    if (!confirm(`Supprimer "${item.file_name}" ?`)) return;
    await supabase.storage.from("planning-pdfs").remove([item.file_path]);
    const { error } = await supabase.from("plannings").delete().eq("id", item.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Supprimé");
      setItems((prev) => prev.filter((p) => p.id !== item.id));
    }
  };

  const handleDownload = async (item: Planning) => {
    const { data, error } = await supabase.storage
      .from("planning-pdfs")
      .createSignedUrl(item.file_path, 60);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const SERVICE_NAMES_DISPLAY: { key: string; patterns: string[] }[] = [
    { key: "Rédaction", patterns: ["tds_re_daction", "redaction", "rédaction", "daction"] },
    { key: "Radio", patterns: ["07_radio"] },
    { key: "Scriptes", patterns: ["05_script", "scripte"] },
    { key: "Monteurs", patterns: ["04_monteur", "monteur"] },
    { key: "Prise de vue", patterns: ["02_prise", "prise de vue"] },
    { key: "Fab régie vidéo", patterns: ["01_fab_re_gie_vide", "fab régie vidéo", "fab regie video", "régie vidéo", "gie_vide"] },
    { key: "Encadrement Technique", patterns: ["08_encad", "encadrement technique", "encad. technique"] },
    { key: "CDD", patterns: ["09_cdd", "5.cdd"] },
    { key: "Direction", patterns: ["direction_s"] },
    { key: "Finance et gestion", patterns: ["finance_et_gestion", "finance et gestion"] },
    { key: "Organisation d'activités", patterns: ["organisation_d_activite", "organisation activite"] },
    { key: "Prog Prod Radio TV", patterns: ["prog_prod", "prog prod"] },
    { key: "Animatrices CDI", patterns: ["animatrices_cdi", "animatrices cdi"] },
    { key: "Infographie", patterns: ["06_infographie", "infographie"] },
    { key: "Fab régie son", patterns: ["03_fab_re_gie_son", "fab régie son", "fab regie son", "gie_son", "régie son"] },
  ];

  function detectServiceName(fileName: string): string {
    const lower = fileName.toLowerCase();
    const matched = SERVICE_NAMES_DISPLAY.find(s => s.patterns.some(p => lower.includes(p)));
    return matched?.key ?? "Autre";
  }

  function normalizeEmployeeName(name: string): string {
    return name.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[\s,]+/).filter(Boolean).sort().join(" ");
  }

  const myNorm = myFullName ? normalizeEmployeeName(myFullName) : null;

  const myServicePlannings = items.filter(p => {
    if (!myNorm) return true;
    const payload = (p.ai_raw_json as any)?.result ?? p.ai_raw_json;
    const employees: string[] = payload?.employees_detected ?? [];
    return employees.some(e => normalizeEmployeeName(e) === myNorm);
  });

  const otherServicePlannings = items.filter(p => {
    if (!myNorm) return false;
    const payload = (p.ai_raw_json as any)?.result ?? p.ai_raw_json;
    const employees: string[] = payload?.employees_detected ?? [];
    return !employees.some(e => normalizeEmployeeName(e) === myNorm);
  });

  const otherServicesByName = otherServicePlannings.reduce((acc, p) => {
    const name = detectServiceName(p.file_name ?? "");
    if (!acc[name]) acc[name] = [];
    acc[name].push(p);
    return acc;
  }, {} as Record<string, Planning[]>);

  return (
    <AppShell title="Planning">
      {(analyzingId || autoProgress) && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <p className="text-sm text-muted-foreground">
            {autoProgress
              ? `Analyse en cours... ${autoProgress.done}/${autoProgress.total}`
              : "Analyse du planning en cours..."}
          </p>
        </div>
      )}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="-mt-4">
        <TabsList className="flex w-full overflow-x-auto sm:w-auto sm:inline-flex">
          <TabsTrigger value="me" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <CalendarDays className="h-4 w-4 shrink-0" />
            <span>Mon planning</span>
          </TabsTrigger>
          <TabsTrigger value="service" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <Users className="h-4 w-4 shrink-0" />
            <span className="hidden xs:inline">Planning du service</span>
            <span className="xs:hidden">Service</span>
          </TabsTrigger>
          <TabsTrigger value="others" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <Building2 className="h-4 w-4 shrink-0" />
            <span className="hidden xs:inline">Autres services</span>
            <span className="xs:hidden">Autres</span>
          </TabsTrigger>
          <TabsTrigger value="pdfs" className="gap-1.5 shrink-0 text-xs sm:text-sm">
            <Files className="h-4 w-4 shrink-0" />
            <span className="hidden xs:inline">PDF importés</span>
            <span className="xs:hidden">PDF</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="me" className="mt-6 space-y-8">
          {loading ? (
            <div className="flex items-center justify-center p-10 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
            </div>
          ) : shifts.length === 0 ? (
            <div className="rounded-2xl border border-border/60 p-8 text-center text-sm text-muted-foreground">
              Aucun shift à afficher pour le moment. Importez un PDF et lancez l'analyse depuis l'onglet
              « PDF importés ».
            </div>
          ) : (
            (() => {
              const currentWs = weekStartUTC(getTodayUTC()).getTime();
              const nextWs = currentWs + 7 * 24 * 60 * 60 * 1000;
              const currentShifts: Shift[] = [];
              const nextShifts: Shift[] = [];
              const pastShifts: Shift[] = [];
              for (const s of shifts) {
                const m = s.shift_date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (!m) {
                  pastShifts.push(s);
                  continue;
                }
                const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
                const ws = weekStartUTC(d).getTime();
                if (ws === currentWs) currentShifts.push(s);
                else if (ws === nextWs) nextShifts.push(s);
                else pastShifts.push(s);
              }




              return (
                <>
                  {/* SECTION 1: Semaine en cours (always visible) */}
                  <section className="space-y-6">
                    <h3 className="font-display text-lg font-semibold">Semaine en cours</h3>
                    {currentShifts.length > 0 ? (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold text-muted-foreground">Mon planning</h4>
                        <WeekSummaryView shifts={currentShifts} onDaySelect={setSelectedDay} />
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-border/60 p-6 text-center text-sm text-muted-foreground">
                        Aucun shift pour la semaine en cours.
                      </div>
                    )}

                    {selectedDay === null ? (
                      <div className="rounded-2xl border border-border/60 p-6 text-center text-sm text-muted-foreground">
                        <CalendarDays className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                        Sélectionnez un jour dans le planning pour voir son détail.
                      </div>
                    ) : (
                      <div ref={dayDetailRef} className="space-y-3">
                        <div className="flex items-baseline justify-between">
                          <h4 className="font-display text-base font-semibold">Détail du jour</h4>
                          <button
                            type="button"
                            onClick={() => {
                              const dayToReturn = selectedDay;
                              if (dayToReturn) {
                                const el = document.getElementById(`week-day-${dayToReturn}`);
                                if (el) {
                                  el.scrollIntoView({ behavior: "smooth", block: "center" });
                                  el.classList.add("ring-2", "ring-primary", "rounded-lg");
                                  setTimeout(() => {
                                    el.classList.remove("ring-2", "ring-primary", "rounded-lg");
                                  }, 1600);
                                }
                              }
                              setSelectedDay(null);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                            Fermer le détail
                          </button>
                        </div>
                        <DayDetailView dateStr={selectedDay} items={shifts.filter((s) => s.shift_date === selectedDay)} />
                      </div>
                    )}

                  </section>


                  {/* SECTION 2: Semaine suivante (collapsed, only if data) */}
                  {nextShifts.length > 0 && (
                    <Accordion type="single" collapsible className="border-t border-border/60 pt-4">
                      <AccordionItem value="next" className="border-b-0">
                        <AccordionTrigger className="font-display text-lg font-semibold">
                          Semaine suivante
                        </AccordionTrigger>
                        <AccordionContent className="pt-4">
                          <WeekSummaryView shifts={nextShifts} onDaySelect={setSelectedDay} />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}

                  {/* SECTION 3: Anciens plannings (collapsed) */}
                  {pastShifts.length > 0 && (
                    <Accordion type="single" collapsible className="border-t border-border/60 pt-4">
                      <AccordionItem value="past" className="border-b-0">
                        <AccordionTrigger className="font-display text-lg font-semibold">
                          Anciens plannings
                        </AccordionTrigger>
                        <AccordionContent className="pt-4">
                          <WeekSummaryView shifts={pastShifts} onDaySelect={setSelectedDay} />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </>
              );
            })()
          )}
        </TabsContent>


        <TabsContent value="service" className="mt-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center p-10 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
            </div>
          ) : (
            (() => {
              const allEvents: any[] = [];
              for (const p of myServicePlannings) {
                const payload = (p.ai_raw_json as any)?.result ?? p.ai_raw_json;
                // Pipelines existants (OPS, etc.) : events déjà au format ServiceEvent
                const svc = payload?.service_events;
                if (Array.isArray(svc)) {
                  for (const ev of svc) {
                    if (ev && typeof ev === "object") allEvents.push(ev);
                  }
                }
                // Fallback rédaction : si service_events vide (données pré-migration),
                // reconstruire depuis raw_grid.cells pour rétrocompatibilité.
                if (payload?.pipeline === "redaction" && (!Array.isArray(svc) || svc.length === 0)) {
                  const cells = payload?.raw_grid?.cells;
                  if (Array.isArray(cells)) {
                    for (const c of cells) {
                      if (!c || c.empty) continue;
                      const txt = (c.raw_text ?? "").trim();
                      if (!txt) continue;
                      allEvents.push({
                        employee: c.employee,
                        date: c.date,
                        raw_text: c.raw_text,
                        all_day: true,
                      });
                    }
                  }
                }
              }
              return <ServicePlanningView events={allEvents} />;
            })()
          )}
        </TabsContent>

        <TabsContent value="pdfs" className="mt-6 space-y-6">
          <p className="text-muted-foreground text-sm">
            Importez votre planning PDF puis lancez l'analyse pour extraire les shifts.
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-primary-glow bg-accent/30" : "border-border"
            }`}
            style={{ background: dragOver ? undefined : "var(--gradient-surface)" }}
          >
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent/50">
              {uploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary-glow" />
              ) : (
                <Upload className="h-5 w-5 text-primary-glow" />
              )}
            </div>
            <h2 className="mt-4 font-display text-xl font-semibold">Importer un planning</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Glissez un PDF ici ou cliquez pour parcourir.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <button
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="mt-5 rounded-lg px-5 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-60"
              style={{ background: "var(--gradient-primary)" }}
            >
              {uploading ? "Import en cours..." : "Choisir un fichier PDF"}
            </button>
          </div>

          <div>
            <h3 className="font-display text-lg font-semibold">Plannings importés</h3>
            <div
              className="mt-4 rounded-2xl border border-border/60"
              style={{ background: "var(--gradient-surface)" }}
            >
              {loading ? (
                <div className="flex items-center justify-center p-10 text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
                </div>
              ) : items.length === 0 ? (
                <div className="p-10 text-center text-sm text-muted-foreground">
                  Aucun planning importé pour le moment.
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {items.map((item) => {
                    const isAnalyzing = analyzingId === item.id || item.status === "processing";
                    return (
                      <li key={item.id} className="flex flex-wrap items-center gap-3 p-4">
                        <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/50">
                          <FileText className="h-5 w-5 text-primary-glow" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium">{item.file_name}</p>
                            <StatusBadge status={item.status} />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {new Date(item.created_at).toLocaleString("fr-FR")} ·{" "}
                            {formatSize(item.size_bytes)}
                            {item.page_count ? ` · ${item.page_count} page${item.page_count > 1 ? "s" : ""}` : ""}
                          </p>
                          {item.status === "failed" && item.error_message && (
                            <p className="mt-1 text-xs text-destructive">{item.error_message}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleAnalyze(item)}
                          disabled={isAnalyzing}
                          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
                          style={{ background: "var(--gradient-primary)" }}
                        >
                          {isAnalyzing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                          {item.status === "completed" ? "Réanalyser" : "Analyser le PDF"}
                        </button>
                        {item.status === "completed" && (
                          <Link
                            to="/planning/$id"
                            params={{ id: item.id }}
                            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent"
                          >
                            <Eye className="h-4 w-4" /> Détails
                          </Link>
                        )}
                        <button
                          onClick={() => handleDownload(item)}
                          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label="Télécharger"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(item)}
                          className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Supprimer"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="others" className="mt-6 space-y-8">

          {loading ? (

            <div className="flex items-center justify-center p-10 text-muted-foreground">

              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…

            </div>

          ) : otherServicePlannings.length === 0 ? (

            <div className="text-center text-muted-foreground py-10">

              <p className="text-sm">Aucun planning d'autre service importé.</p>

              <p className="text-xs mt-1">Importez un PDF d'un autre service pour le voir apparaître ici.</p>

            </div>

          ) : (() => {

            const now = new Date();

            const startOfWeek = (d: Date) => {

              const day = d.getDay();

              const diff = d.getDate() - day + (day === 0 ? -6 : 1);

              return new Date(d.getFullYear(), d.getMonth(), diff);

            };

            const currentWeekStart = startOfWeek(now);

            const nextWeekStart = new Date(currentWeekStart);

            nextWeekStart.setDate(nextWeekStart.getDate() + 7);

            const prevWeekStart = new Date(currentWeekStart);

            prevWeekStart.setDate(prevWeekStart.getDate() - 7);

            const getWeekLabel = (p: Planning) => {

              const payload = (p.ai_raw_json as any)?.result ?? p.ai_raw_json;

              const start = payload?.week_range?.start;

              if (!start) return "other";

              const d = new Date(start);

              if (d >= currentWeekStart && d < nextWeekStart) return "current";

              if (d >= nextWeekStart) return "next";

              return "past";

            };

            const deriveServiceFromFileName = (fileName: string): string => {
              let n = (fileName ?? "").replace(/\.pdf$/i, "");
              n = n.replace(/^\s*TDS\s+/i, "");
              n = n.replace(/^\s*\d+\s+/, "");
              n = n.replace(/\s+S\d+\s*$/i, "");
              return n.trim();
            };

            const grouped: Record<string, Record<string, Planning[]>> = {};

            // First pass: count extracted service names per week to detect collisions
            const weekServiceCounts: Record<string, Record<string, number>> = {};
            for (const p of otherServicePlannings) {
              const weekLabel = getWeekLabel(p);
              const payload = (p.ai_raw_json as any)?.result ?? p.ai_raw_json;
              const extracted = payload?.service_name ?? detectServiceName(p.file_name ?? "");
              if (!weekServiceCounts[weekLabel]) weekServiceCounts[weekLabel] = {};
              weekServiceCounts[weekLabel][extracted] = (weekServiceCounts[weekLabel][extracted] ?? 0) + 1;
            }

            for (const p of otherServicePlannings) {

              const weekLabel = getWeekLabel(p);

              const payload = (p.ai_raw_json as any)?.result ?? p.ai_raw_json;

              const extracted = payload?.service_name ?? detectServiceName(p.file_name ?? "");

              const isCollision = (weekServiceCounts[weekLabel]?.[extracted] ?? 0) > 1;

              const serviceName = isCollision
                ? (deriveServiceFromFileName(p.file_name ?? "") || extracted)
                : extracted;

              if (!grouped[weekLabel]) grouped[weekLabel] = {};

              if (!grouped[weekLabel][serviceName]) grouped[weekLabel][serviceName] = [];

              grouped[weekLabel][serviceName].push(p);

            }


            const weekOrder = ["current", "next", "past"];

            const weekTitles: Record<string, string> = {

              current: "Semaine en cours",

              next: "Semaine suivante",

              past: "Semaines passées",

            };

            return (

              <div className="space-y-8">

                {weekOrder.filter(w => grouped[w]).map(weekKey => (

                  <div key={weekKey}>

                    <h2 className="text-lg font-semibold mb-4">{weekTitles[weekKey]}</h2>

                    <div className="space-y-3">

                      {Object.entries(grouped[weekKey]).sort(([a], [b]) => a.localeCompare(b)).map(([serviceName, plannings]) => (

                        <details key={serviceName} className="rounded-lg border border-border/60 overflow-hidden">

                          <summary className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-accent/50 select-none">

                            <div className="flex items-center gap-2">

                              <Building2 className="h-4 w-4 text-muted-foreground" />

                              <span className="font-medium">{serviceName}</span>

                            </div>

                            <span className="text-xs text-muted-foreground">

                              {plannings.reduce((acc, p) => {

                                const payload = (p.ai_raw_json as any)?.result ?? p.ai_raw_json;

                                const emps: string[] = payload?.employees_detected ?? [];

                                return acc + emps.length;

                              }, 0)} salarié(s)

                            </span>

                          </summary>

                          <div className="p-4 border-t border-border/60">

                            {plannings.map(p => {

                              const payload = (p.ai_raw_json as any)?.result ?? p.ai_raw_json;

                              const weekRange = payload?.week_range;

                              const serviceEvents = (() => {

                                const svc = payload?.service_events;

                                if (Array.isArray(svc) && svc.length > 0) return svc;

                                if (payload?.pipeline === "redaction") {

                                  const cells = payload?.raw_grid?.cells;

                                  if (Array.isArray(cells)) {

                                    return cells.filter((c: any) => !c.empty && c.raw_text?.trim()).map((c: any) => ({

                                      employee: c.employee,

                                      date: c.date,

                                      raw_text: c.raw_text,

                                      all_day: true,

                                    }));

                                  }

                                }

                                return [];

                              })();

                              return (

                                <ServicePlanningView key={p.id} events={serviceEvents} weekStart={weekRange?.start ?? null} />

                              );

                            })}

                          </div>

                        </details>

                      ))}

                    </div>

                  </div>

                ))}

              </div>

            );

          })()}

        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
