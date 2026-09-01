import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { CalendarDays, FileText, Mail, ShieldCheck, ArrowUpRight, Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cleanActivityPrefix, getTodayUTC, weekStartUTC } from "@/lib/utils";

type NextShift = {
  id: string;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  activity: string | null;
  notes: string | null;
};

function pad2(n: number) { return String(n).padStart(2, "0"); }

async function fetchNextShiftClient(): Promise<NextShift | null> {
  const { data, error } = await supabase
    .from("shifts")
    .select("id, shift_date, start_time, end_time, activity, notes")
    .order("shift_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false });
  if (error || !data || data.length === 0) return null;

  const now = new Date();
  const todayISO = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const shift of data as NextShift[]) {
    const date = shift.shift_date;
    if (!date) continue;
    if (date > todayISO) return shift;
    if (date === todayISO) {
      if (!shift.start_time) return shift;
      const sm = shift.start_time.match(/^(\d{2}):(\d{2})/);
      if (!sm) return shift;
      const startMinutes = parseInt(sm[1], 10) * 60 + parseInt(sm[2], 10);
      if (startMinutes >= currentMinutes) return shift;
    }
  }
  return null;
}


export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord — HorIA" }] }),
  component: Dashboard,
});

function StatCard({ icon: Icon, label, value, hint, to }: { icon: typeof CalendarDays; label: string; value: string; hint: string; to: string }) {
  return (
    <Link to={to} className="group relative overflow-hidden rounded-2xl border border-border/60 p-5 transition-all hover:border-primary/40" style={{ background: "var(--gradient-surface)" }}>
      <div className="flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/50">
          <Icon className="h-4 w-4 text-primary-glow" />
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <div className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </Link>
  );
}

const DAYS_LONG = [
  "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi",
];
const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

function formatDayName(d: Date): string {
  return DAYS_LONG[d.getUTCDay()];
}
function formatLongDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function parseDate(d: string | null): Date | null {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month) return null;
  return date;
}

function formatTime(t: string | null): string | null {
  if (!t) return null;
  return t.slice(0, 5);
}

const PAID_LEAVE_MINUTES: Record<string, number> = {
  RTT_EMPLOYEUR: 468, // 7h48
};

function getPaidLeaveMinutes(activity: string | null): number {
  if (!activity) return 0;
  const a = activity.trim().toUpperCase().replace(/\s+/g, "_");
  for (const [token, minutes] of Object.entries(PAID_LEAVE_MINUTES)) {
    if (a === token || a.startsWith(token + "_")) {
      return minutes;
    }
  }
  return 0;
}

function computeDuration(start: string | null, end: string | null, activity: string | null): string | null {
  const paidMinutes = getPaidLeaveMinutes(activity);
  if (paidMinutes > 0) {
    const h = Math.floor(paidMinutes / 60);
    const m = paidMinutes % 60;
    if (m === 0) return `${h} h`;
    return `${h} h ${String(m).padStart(2, "0")}`;
  }
  if (!start || !end) return null;
  const sm = start.match(/^(\d{2}):(\d{2})/);
  const em = end.match(/^(\d{2}):(\d{2})/);
  if (!sm || !em) return null;
  const s = parseInt(sm[1], 10) * 60 + parseInt(sm[2], 10);
  let e = parseInt(em[1], 10) * 60 + parseInt(em[2], 10);
  if (e < s) e += 24 * 60;
  const total = e - s;
  if (total <= 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

function isAbsence(activity: string | null): boolean {
  if (!activity) return false;
  const a = activity.trim().toUpperCase();
  return ["RH", "RTT_EMPLOYEUR", "RTT EMPLOYEUR", "JNT", "CP", "RC", "AM", "ABS", "RÉCUPÉRATION SALARIÉ", "RÉCUPÉRATION COLLAB"].some(
    (token) => a === token || a.startsWith(token + " ") || a.startsWith(token + "_") || a.startsWith(token + "/"),
  );
}

const ABSENCE_TOKENS = [
  "RH",
  "RTT EMPLOYEUR",
  "RTT_EMPLOYEUR",
  "RTT SALARIE",
  "RTT_SALARIE",
  "JNT",
  "CP",
  "RC",
  "AM",
  "ABS",
  "RECUPERATION SALARIE",
  "RECUPERATION_SALARIE",
];

function normalizeActivity(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function activityToken(activity: string | null): string | null {
  if (!activity) return null;
  const a = normalizeActivity(activity);
  for (const t of ABSENCE_TOKENS) {
    if (a === t || a.startsWith(t + " ") || a.startsWith(t + "_")) return t.replace(/ /g, "_");
  }
  return null;
}


function minutesOf(start: string | null, end: string | null, activity: string | null): number {
  const paidMinutes = getPaidLeaveMinutes(activity);
  if (paidMinutes > 0) return paidMinutes;
  if (!start || !end) return 0;
  const sm = start.match(/^(\d{2}):(\d{2})/);
  const em = end.match(/^(\d{2}):(\d{2})/);
  if (!sm || !em) return 0;
  const s = parseInt(sm[1], 10) * 60 + parseInt(sm[2], 10);
  let e = parseInt(em[1], 10) * 60 + parseInt(em[2], 10);
  if (e < s) e += 24 * 60;
  return Math.max(0, e - s);
}

function fmtDuration(total: number): string {
  if (total <= 0) return "0h00";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

async function fetchAllShifts(): Promise<NextShift[]> {
  const { data, error } = await supabase
    .from("shifts")
    .select("id, shift_date, start_time, end_time, activity, notes")
    .order("shift_date", { ascending: true });
  if (error || !data) return [];
  return data as NextShift[];
}

function WeekSummaryCard() {
  const { data: shifts, isLoading } = useQuery({
    queryKey: ["week-summary-shifts"],
    queryFn: fetchAllShifts,
  });

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-border/60 p-6 lg:col-span-2" style={{ background: "var(--gradient-surface)" }}>
        <h2 className="font-display text-lg font-semibold">Résumé de la semaine en cours</h2>
        <div className="mt-6 flex items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">Chargement…</p>
        </div>
      </div>
    );
  }

  const today = getTodayUTC();
  const ws = weekStartUTC(today);
  const we = new Date(ws);
  we.setUTCDate(ws.getUTCDate() + 6);
  const wsStr = ws.toISOString().slice(0, 10);
  const weStr = we.toISOString().slice(0, 10);

  const weekShifts = (shifts ?? []).filter((s) => {
    if (!s.shift_date) return false;
    return s.shift_date >= wsStr && s.shift_date <= weStr;
  });

  if (weekShifts.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 p-6 lg:col-span-2" style={{ background: "var(--gradient-surface)" }}>
        <h2 className="font-display text-lg font-semibold">Résumé de la semaine en cours</h2>
        <div className="mt-6 flex flex-col items-center justify-center py-12 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Aucun shift cette semaine.</p>
          <Link to="/planning" className="mt-4 rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>
            Aller au planning
          </Link>
        </div>
      </div>
    );
  }

  let totalMinutes = 0;
  let totalShifts = 0;
  const rttDays = new Set<string>();
  const rhDays = new Set<string>();
  const jntDays = new Set<string>();

  for (const s of weekShifts) {
    totalShifts++;
    totalMinutes += minutesOf(s.start_time, s.end_time, s.activity);
    const tk = activityToken(s.activity);
    const date = s.shift_date;
    if (!date) continue;
    if (tk === "RTT_EMPLOYEUR" || tk === "RTT_SALARIE") rttDays.add(date);
    if (tk === "RH") rhDays.add(date);
    if (tk === "JNT") jntDays.add(date);
  }

  const stats = [
    { label: "Total heures", value: fmtDuration(totalMinutes), color: "text-foreground" },
    { label: "Shifts", value: String(totalShifts), color: "text-foreground" },
    { label: "RTT", value: String(rttDays.size), color: "text-amber-500" },
    { label: "RH", value: String(rhDays.size), color: "text-amber-500" },
    { label: "JNT", value: String(jntDays.size), color: "text-amber-500" },
  ];

  return (
    <div className="rounded-2xl border border-border/60 p-6 lg:col-span-2" style={{ background: "var(--gradient-surface)" }}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold">Résumé de la semaine en cours</h2>
        <Link to="/planning" className="text-xs text-primary hover:underline">
          Voir le planning →
        </Link>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-border/40 bg-card/50 p-4">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
            <div className={`mt-1 font-display text-2xl font-bold ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NextShiftCard() {
  const { data: shift, isLoading } = useQuery({
    queryKey: ["next-shift"],
    queryFn: fetchNextShiftClient,
  });

  if (isLoading) {
    return (
      <Link to="/planning" className="group relative overflow-hidden rounded-2xl border border-border/60 p-5 transition-all hover:border-primary/40" style={{ background: "var(--gradient-surface)" }}>
        <div className="flex items-start justify-between">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/50">
            <CalendarDays className="h-4 w-4 text-primary-glow" />
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
        <div className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Prochain créneau</div>
        <div className="mt-1 font-display text-2xl font-bold">—</div>
        <div className="mt-1 text-xs text-muted-foreground">Chargement…</div>
      </Link>
    );
  }

  if (!shift) {
    return (
      <Link to="/planning" className="group relative overflow-hidden rounded-2xl border border-border/60 p-5 transition-all hover:border-primary/40" style={{ background: "var(--gradient-surface)" }}>
        <div className="flex items-start justify-between">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/50">
            <CalendarDays className="h-4 w-4 text-primary-glow" />
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
        <div className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Prochain créneau</div>
        <div className="mt-1 font-display text-2xl font-bold">—</div>
        <div className="mt-1 text-xs text-muted-foreground">Aucun horaire importé</div>
      </Link>
    );
  }

  const date = parseDate(shift.shift_date);
  const dayLabel = date ? `${formatDayName(date)} ${formatLongDate(date)}` : "Date inconnue";
  const start = formatTime(shift.start_time);
  const end = formatTime(shift.end_time);
  const duration = computeDuration(shift.start_time, shift.end_time, shift.activity);
  const absence = isAbsence(shift.activity);
  const activity = cleanActivityPrefix(shift.activity);

  return (
    <Link to="/planning" className="group relative overflow-hidden rounded-2xl border border-border/60 p-5 transition-all hover:border-primary/40" style={{ background: "var(--gradient-surface)" }}>
      <div className="flex items-start justify-between">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/50">
          <CalendarDays className="h-4 w-4 text-primary-glow" />
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
      <div className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Prochain créneau</div>
      <div className="mt-2 text-sm font-semibold">{dayLabel}</div>
      {start || end ? (
        <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="h-3.5 w-3.5 text-primary" />
          <span>{start ?? "—"} → {end ?? "—"}</span>
          {duration && (
            <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {duration}
            </span>
          )}
        </div>
      ) : (
        <div className="mt-1 text-sm text-muted-foreground">
          {absence ? "Toute la journée" : "Horaire non précisé"}
        </div>
      )}
      <div className={`mt-1 text-sm font-medium ${absence ? "text-amber-500" : "text-foreground"}`}>
        {activity}
      </div>
    </Link>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const hello = user?.user_metadata?.first_name || user?.email?.split("@")[0] || "vous";

  return (
    <AppShell title={`Bonjour, ${hello} 👋`}>
      <p className="-mt-6 text-muted-foreground">Voici un aperçu de votre journée.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NextShiftCard />
        <StatCard icon={FileText} label="Dernière fiche" value="—" hint="Importez votre première" to="/payroll" />
        <StatCard icon={ShieldCheck} label="Documents" value="0" hint="Coffre-fort vide" to="/vault" />
        <StatCard icon={Mail} label="E-mails à traiter" value="0" hint="Boîte synchronisée" to="/emails" />
      </div>

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <WeekSummaryCard />
      </div>
    </AppShell>
  );
}
