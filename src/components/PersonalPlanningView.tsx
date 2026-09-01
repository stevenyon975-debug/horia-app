import { Calendar, Clock } from "lucide-react";
import { cleanActivityPrefix, compareWeeksForDisplay, getWeekBadge, weekStartUTC, type WeekBadge } from "@/lib/utils";

function WeekBadgePill({ badge }: { badge: WeekBadge }) {
  if (!badge) return null;
  if (badge === "current") {
    return (
      <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
        Semaine en cours
      </span>
    );
  }
  if (badge === "next") {
    return (
      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
        Semaine suivante
      </span>
    );
  }
  if (badge === "forecast") {
    return (
      <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-500">
        Prévisionnel
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      Historique
    </span>
  );
}

const MONTHS_SHORT = [
  "janv.", "févr.", "mars", "avril", "mai", "juin",
  "juil.", "août", "sept.", "oct.", "nov.", "déc.",
];
function shortDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}
function addDaysUTC(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(d.getUTCDate() + n);
  return r;
}

type ShiftRow = {
  id: string;
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  activity: string | null;
  notes?: string | null;
  confidence?: string | null;
};

const DAYS_LONG = [
  "Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi",
];
const MONTHS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

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

function formatDayName(d: Date): string {
  return DAYS_LONG[d.getUTCDay()];
}
function formatLongDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function formatTime(t: string | null): string | null {
  if (!t) return null;
  return t.slice(0, 5);
}

const PAID_LEAVE_MINUTES: Record<string, number> = {
  RTT_EMPLOYEUR: 468, // 7h48
  RECUPERATION_SALARIE: 468, // 7h48, même règle que RTT employeur
};

function getPaidLeaveMinutes(activity: string | null): number {
  if (!activity) return 0;
  const a = stripAccents(activity.trim().toUpperCase()).replace(/\s+/g, "_");
  for (const [token, minutes] of Object.entries(PAID_LEAVE_MINUTES)) {
    if (a === token || a.startsWith(token + "_")) {
      return minutes;
    }
  }
  if (a.startsWith("RECUPERATION_COLLAB") || a.startsWith("RECUPERATION_EMPL")) {
    return 468;
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
  if (e < s) e += 24 * 60; // shift de nuit
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

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const STATUS_BADGES: { key: string; label: string; cls: string }[] = [
  { key: "JNT", label: "JNT", cls: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  { key: "RTT EMPLOYEUR", label: "RTT Employeur", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  { key: "RTT SALARIE", label: "RTT Salarié", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  { key: "RTT", label: "RTT", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  { key: "Recuperation salarie", label: "Récupération Salarié", cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
  { key: "Recuperation collab", label: "Récupération", cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
  { key: "RH", label: "RH", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  { key: "Formation", label: "Formation", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  { key: "Voyage", label: "Voyage", cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  { key: "Heures de delegation", label: "Heures de délégation", cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
  { key: "Conge maternite", label: "Congé maternité", cls: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30" },
  { key: "Conges", label: "Congés", cls: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30" },
  { key: "Absence maladie", label: "Absence maladie", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" },
  { key: "Accident du travail", label: "Accident du travail", cls: "bg-red-500/15 text-red-400 border-red-500/30" },
  { key: "Absence a regulariser", label: "Absence à régulariser", cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
];

// Retire la portion correspondant au badge détecté, en localisant la plage
// sur le texte sans accents puis en l'appliquant au texte original (les
// caractères de base restent alignés après suppression des diacritiques).
function stripBadgeText(original: string, key: string): string {
  const pattern = `\\b${key.replace(/ /g, "\\s+")}\\b`;
  const re = new RegExp(pattern, "gi");
  const stripped = stripAccents(original);
  const ranges: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  let result = original;
  for (const [start, end] of ranges.reverse()) {
    result = result.slice(0, start) + result.slice(end);
  }
  return result.replace(/\s+/g, " ").trim();
}

function renderActivityWithBadge(activity: string | null) {
  if (!activity) return <span className="break-words font-semibold">—</span>;
  const text = cleanActivityPrefix(activity);
  const textNoAccents = stripAccents(text);
  for (const b of STATUS_BADGES) {
    const pattern = `\\b${b.key.replace(/ /g, "\\s+")}\\b`;
    const re = new RegExp(pattern, "i");
    if (re.test(textNoAccents)) {
      // "RH" est ambigu : il apparaît dans "Responsable RH". On ne le traite
      // comme badge que s'il est seul sur sa ligne (ou seul dans la cellule).
      if (b.key === "RH") {
        const standalone = textNoAccents.split(/\r?\n/).some((l) => /^\s*RH\s*$/i.test(l));
        if (!standalone) continue;
      }
      const cleaned = stripBadgeText(text, b.key);
      if (!cleaned) {
        return (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
            {b.label.toUpperCase()}
          </span>
        );
      }
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
            {b.label.toUpperCase()}
          </span>
          <span className="break-words font-medium">{cleaned}</span>
        </span>
      );
    }
  }
  return <span className="break-words font-medium">{text}</span>;
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function PersonalPlanningView({ shifts }: { shifts: ShiftRow[] }) {
  // Trier par date puis heure de début (les sans-date à la fin)
  const sorted = [...shifts].sort((a, b) => {
    const da = a.shift_date ?? "";
    const db = b.shift_date ?? "";
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da.localeCompare(db);
    }
    const sa = a.start_time ?? "";
    const sb = b.start_time ?? "";
    return sa.localeCompare(sb);
  });

  // Grouper par date
  const groups = new Map<string, ShiftRow[]>();
  for (const s of sorted) {
    const key = s.shift_date ?? "__no_date__";
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  if (sorted.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 p-6 text-center text-sm text-muted-foreground">
        Aucun shift à afficher pour le moment.
      </div>
    );
  }

  // Regrouper par semaine (lundi UTC). Les éléments sans date vont dans un bucket dédié à la fin.
  type DayGroup = { key: string; date: Date | null; items: ShiftRow[] };
  const dayGroups: DayGroup[] = Array.from(groups.entries()).map(([key, items]) => ({
    key,
    date: parseDate(key),
    items,
  }));

  type WeekBucket = { weekStart: Date | null; key: string; days: DayGroup[] };
  const weekMap = new Map<string, WeekBucket>();
  for (const g of dayGroups) {
    if (!g.date) {
      const k = "__no_date__";
      let b = weekMap.get(k);
      if (!b) {
        b = { weekStart: null, key: k, days: [] };
        weekMap.set(k, b);
      }
      b.days.push(g);
      continue;
    }
    const ws = weekStartUTC(g.date);
    const k = ws.toISOString().slice(0, 10);
    let b = weekMap.get(k);
    if (!b) {
      b = { weekStart: ws, key: k, days: [] };
      weekMap.set(k, b);
    }
    b.days.push(g);
  }

  const orderedWeeks = Array.from(weekMap.values()).sort((a, b) => {
    if (!a.weekStart) return 1;
    if (!b.weekStart) return -1;
    return compareWeeksForDisplay(a.weekStart, b.weekStart);
  });
  for (const b of orderedWeeks) {
    b.days.sort((a, b2) => {
      if (!a.date) return 1;
      if (!b2.date) return -1;
      return a.date.getTime() - b2.date.getTime(); // asc within week
    });
  }

  return (
    <div className="space-y-6">
      {orderedWeeks.map((wk) => {
        const badge = wk.weekStart ? getWeekBadge(wk.weekStart) : null;
        const weekEnd = wk.weekStart ? addDaysUTC(wk.weekStart, 6) : null;
        return (
          <div key={wk.key} className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-2 px-1">
              <Calendar className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">
                {wk.weekStart && weekEnd
                  ? `Semaine ${getISOWeek(wk.weekStart)} · du ${shortDate(wk.weekStart)} au ${shortDate(weekEnd)}`
                  : "Sans date"}
              </h3>
              <WeekBadgePill badge={badge} />
              {badge === "forecast" && (
                <button
                  type="button"
                  className="ml-auto rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  Remplacer le planning
                </button>
              )}
            </div>
            <div className="space-y-4">
              {wk.days.map(({ key, date, items }) => {
        const anchorId = date ? `day-${date.toISOString().slice(0, 10)}` : undefined;
        return (
          <div key={key} id={anchorId} className="space-y-2 scroll-mt-20">
            <div className="flex items-baseline gap-2 px-1">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-sm font-semibold capitalize">
                {date ? formatDayName(date) : "Sans date"}
              </h4>
              {date && (
                <span className="text-xs text-muted-foreground">
                  {formatLongDate(date)}
                </span>
              )}
              {items.length > 1 && (
                <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {items.length} créneaux
                </span>
              )}
            </div>

            <div className="space-y-2">
              {items.map((s) => {
                const start = formatTime(s.start_time);
                const end = formatTime(s.end_time);
                const duration = computeDuration(s.start_time, s.end_time, s.activity);
                const paidLeave = getPaidLeaveMinutes(s.activity) > 0;

                return (
                  <div
                    key={s.id}
                    className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      {/* Bloc horaires */}
                      <div className="min-w-[88px] shrink-0">
                        {start || end ? (
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1 font-mono text-base font-semibold tabular-nums text-foreground">
                              <Clock className="h-3.5 w-3.5 text-primary" />
                              {start ?? "—"}
                            </div>
                            <div className="font-mono text-sm tabular-nums text-muted-foreground">
                              → {end ?? "—"}
                            </div>
                            {duration && (
                              <div className="mt-1 inline-flex w-fit rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                {duration}
                              </div>
                            )}
                          </div>
                        ) : paidLeave ? (
                          <div className="mt-1 inline-flex w-fit rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            {duration}
                          </div>
                        ) : (
                          <div className="h-0" aria-hidden="true" />
                        )}
                      </div>

                      {/* Bloc activité */}
                        <div className="min-w-0 flex-1">
                          {renderActivityWithBadge(s.activity)}
                          {s.notes && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {s.notes}
                            </div>
                          )}
                          {s.confidence && (
                            <div className="mt-2 inline-flex rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                              {s.confidence}
                            </div>
                          )}
                        </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
