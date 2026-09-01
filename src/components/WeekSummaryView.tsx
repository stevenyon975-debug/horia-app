import { CalendarDays } from "lucide-react";
import { cleanActivityPrefix, compareWeeksForDisplay, getWeekBadge, type WeekBadge } from "@/lib/utils";

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
  const dt = new Date(Date.UTC(year, month, day));
  if (dt.getUTCDate() !== day || dt.getUTCMonth() !== month) return null;
  return dt;
}

function fmtTime(t: string | null): string | null {
  if (!t) return null;
  return t.slice(0, 5);
}

function shortDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}`;
}

function stripAccentsForLeave(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const PAID_LEAVE_MINUTES: Record<string, number> = {
  RTT_EMPLOYEUR: 468, // 7h48
  RECUPERATION_SALARIE: 468, // 7h48, même règle que RTT employeur
};

function getPaidLeaveMinutes(activity: string | null): number {
  if (!activity) return 0;
  const a = stripAccentsForLeave(activity.trim().toUpperCase()).replace(/\s+/g, "_");
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

// Extrait le décompte de pause "(-01h00)" présent dans le texte d'activité
// d'un shift, en minutes. Ce décompte doit être soustrait de la durée brute
// du créneau horaire (ex. "14h00-22h30 (-01h00)" = 7h30 réelles, pas 8h30).
function getBreakDeductionMinutes(activity: string | null): number {
  if (!activity) return 0;
  const m = activity.match(/\(\s*-\s*(\d{1,2})\s*[hH:]\s*(\d{2})\s*\)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Les heures de voyage font l'objet d'un taux différent en paie : elles ne
// doivent jamais être additionnées au temps de travail normal.
function isVoyageActivity(activity: string | null): boolean {
  if (!activity) return false;
  return /\bvoyage\b/i.test(stripAccentsForLeave(activity));
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
  const breakMin = getBreakDeductionMinutes(activity);
  return Math.max(0, e - s - breakMin);
}

function fmtDuration(total: number): string {
  if (total <= 0) return "0h00";
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

function normalizeActivity(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isAbsence(activity: string | null): boolean {
  if (!activity) return false;
  const a = activity.trim().toUpperCase();
  return ["RH", "RTT_EMPLOYEUR", "RTT EMPLOYEUR", "JNT", "CP", "RC", "AM", "ABS", "RÉCUPÉRATION SALARIÉ", "RÉCUPÉRATION COLLAB"].some(
    (token) => a === token || a.startsWith(token + " ") || a.startsWith(token + "_") || a.startsWith(token + "/"),
  );
}

const STATUS_BADGES: { key: string; label?: string; cls: string }[] = [
  { key: "JNT", cls: "bg-violet-500/15 text-violet-400 border-violet-500/30" },
  { key: "RTT EMPLOYEUR", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  { key: "RTT SALARIE", label: "RTT Salarié", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  { key: "RTT", cls: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  { key: "Recuperation salarie", label: "Récupération Salarié", cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
  { key: "Recuperation collab", label: "Récupération", cls: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
  { key: "RH", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  { key: "Formation", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  { key: "Voyage", cls: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30" },
];

function renderActivityWithBadge(activity: string | null) {
  if (!activity) return <span className="break-words font-medium">—</span>;
  const text = cleanActivityPrefix(activity);
  const textNoAccents = stripAccents(text);
  for (const b of STATUS_BADGES) {
    const re = new RegExp(`\\b${b.key.replace(/ /g, "\\s+")}\\b`, "i");
    if (re.test(textNoAccents)) {
      // "RH" est ambigu : il apparaît dans "Responsable RH". On ne le traite
      // comme badge que s'il est seul sur sa ligne (ou seul dans la cellule).
      if (b.key === "RH") {
        const standalone = textNoAccents.split(/\r?\n/).some((l) => /^\s*RH\s*$/i.test(l));
        if (!standalone) continue;
      }
      if (isAbsence(activity)) {
        return (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
            {(b.label ?? b.key).toUpperCase()}
          </span>
        );
      }
      const cleaned = textNoAccents.replace(new RegExp(`\\b${b.key.replace(/ /g, "\\s+")}\\b`, "gi"), "").replace(/\s+/g, " ").trim();
      if (!cleaned) {
        return (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
            {(b.label ?? b.key).toUpperCase()}
          </span>
        );
      }
      return (
        <span className="flex flex-wrap items-center gap-1">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
            {(b.label ?? b.key).toUpperCase()}
          </span>
          <span className="break-words font-medium">{cleaned}</span>
        </span>
      );
    }
  }
  return <span className="break-words font-medium">{text}</span>;
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

function activityToken(activity: string | null): string | null {
  if (!activity) return null;
  const a = normalizeActivity(activity);
  for (const t of ABSENCE_TOKENS) {
    if (a === t || a.startsWith(t + " ") || a.startsWith(t + "_")) return t.replace(/ /g, "_");
  }
  return null;
}

// ISO week start (Monday)
function weekStart(d: Date): Date {
  const day = d.getUTCDay(); // 0..6 (Sun..Sat)
  const diff = (day + 6) % 7; // Mon=0
  const ws = new Date(d.getTime());
  ws.setUTCDate(d.getUTCDate() - diff);
  return ws;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  r.setUTCDate(d.getUTCDate() + n);
  return r;
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function WeekSummaryView({ shifts, onDaySelect }: { shifts: ShiftRow[]; onDaySelect?: (dateStr: string) => void }) {
  // Group shifts by ISO week (Mon-Sun)
  const withDates = shifts
    .map((s) => ({ s, d: parseDate(s.shift_date) }))
    .filter((x): x is { s: ShiftRow; d: Date } => x.d !== null);

  if (withDates.length === 0) {
    return null;
  }

  // Build weeks map keyed by week start ISO
  const weeks = new Map<string, { start: Date; end: Date; items: { s: ShiftRow; d: Date }[] }>();
  for (const x of withDates) {
    const ws = weekStart(x.d);
    const key = ws.toISOString().slice(0, 10);
    let entry = weeks.get(key);
    if (!entry) {
      entry = { start: ws, end: addDays(ws, 6), items: [] };
      weeks.set(key, entry);
    }
    entry.items.push(x);
  }

  const orderedWeeks = Array.from(weeks.values()).sort((a, b) => compareWeeksForDisplay(a.start, b.start));

  return (
    <div className="space-y-4">
      {orderedWeeks.map((wk) => {
        const badge = getWeekBadge(wk.start);
        // Group items in week by day
        const dayMap = new Map<string, { d: Date; items: ShiftRow[] }>();
        for (const x of wk.items) {
          const key = x.d.toISOString().slice(0, 10);
          let g = dayMap.get(key);
          if (!g) {
            g = { d: x.d, items: [] };
            dayMap.set(key, g);
          }
          g.items.push(x.s);
        }
        for (const g of dayMap.values()) {
          g.items.sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
        }

        // Totals
        let totalMinutes = 0;
        let voyageMinutes = 0;
        let totalShifts = 0;
        const tokenDays = { RH: new Set<string>(), RTT_EMPLOYEUR: new Set<string>(), JNT: new Set<string>() } as Record<string, Set<string>>;
        for (const [key, g] of dayMap.entries()) {
          for (const s of g.items) {
            totalShifts++;
            const mins = minutesOf(s.start_time, s.end_time, s.activity);
            if (isVoyageActivity(s.activity)) voyageMinutes += mins;
            else totalMinutes += mins;
            const tk = activityToken(s.activity);
            if (tk && tokenDays[tk]) tokenDays[tk].add(key);
          }
        }

        // Build ordered 7 days
        const days: { d: Date; items: ShiftRow[] }[] = [];
        for (let i = 0; i < 7; i++) {
          const d = addDays(wk.start, i);
          const key = d.toISOString().slice(0, 10);
          const g = dayMap.get(key);
          if (g) days.push(g);
          else days.push({ d, items: [] });
        }

        return (
          <div key={wk.start.toISOString()} className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                <h4 className="text-sm font-semibold">
                  Semaine {getISOWeek(wk.start)} · du {shortDate(wk.start)} au {shortDate(wk.end)}
                </h4>
                <WeekBadgePill badge={badge} />
              </div>
              {badge === "forecast" && (
                <button
                  type="button"
                  className="ml-auto rounded-md border border-border/60 bg-background px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                >
                  Remplacer le planning
                </button>
              )}
              <div className="ml-auto flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  {totalShifts} shifts
                </span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  {fmtDuration(totalMinutes)}
                </span>
                {voyageMinutes > 0 && (
                  <span className="rounded-full bg-blue-500/15 px-2 py-0.5 font-medium text-blue-400">
                    Voyage {fmtDuration(voyageMinutes)}
                  </span>
                )}
                {tokenDays.RH.size > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-500">
                    {tokenDays.RH.size} RH
                  </span>
                )}
                {tokenDays.RTT_EMPLOYEUR.size > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-500">
                    {tokenDays.RTT_EMPLOYEUR.size} RTT_EMPLOYEUR
                  </span>
                )}
                {tokenDays.JNT.size > 0 && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-500">
                    {tokenDays.JNT.size} JNT
                  </span>
                )}
              </div>
            </div>

            <div className="divide-y divide-border/40">
              {days.map((g) => {
                const dayMinutes = g.items.reduce((acc, s) => acc + minutesOf(s.start_time, s.end_time, s.activity), 0);
                const isEmpty = g.items.length === 0;
                const onlyAbsence = !isEmpty && g.items.every((s) => activityToken(s.activity) !== null && !s.start_time && !s.end_time);

                const dateStr = g.d.toISOString().slice(0, 10);
                return (
                  <div
                    id={`week-day-${dateStr}`}
                    key={g.d.toISOString()}
                    className="py-2 rounded-lg transition-colors hover:bg-muted/40 active:scale-[0.99] active:bg-muted/60 cursor-pointer"
                    onClick={() => {
                      if (onDaySelect) {
                        onDaySelect(dateStr);
                      } else {
                        const id = `day-${dateStr}`;
                        const el = document.getElementById(id);
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "start" });
                          el.classList.add("ring-2", "ring-primary", "rounded-lg");
                          setTimeout(() => {
                            el.classList.remove("ring-2", "ring-primary", "rounded-lg");
                          }, 1600);
                        }
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLDivElement).click();
                      }
                    }}
                  >
                    <div className="flex items-baseline gap-2 px-1">
                      <span className="w-24 shrink-0 text-xs font-semibold capitalize text-foreground">
                        {DAYS_LONG[g.d.getUTCDay()]}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{shortDate(g.d)}</span>
                      {!isEmpty && dayMinutes > 0 && (
                        <span className="ml-auto text-[11px] font-medium text-primary">
                          {fmtDuration(dayMinutes)}
                        </span>
                      )}
                    </div>

                    {isEmpty ? (
                      <div className="mt-0.5 pl-24 text-[11px] italic text-muted-foreground/70">—</div>
                    ) : (
                      <ul className="mt-1 space-y-0.5 pl-24">
                        {g.items.map((s) => {
                          const start = fmtTime(s.start_time);
                          const end = fmtTime(s.end_time);
                          const tk = activityToken(s.activity);
                          const hasBadge = STATUS_BADGES.some((b) => new RegExp(`\\b${b.key}\\b`, "i").test(stripAccents(cleanActivityPrefix(s.activity) ?? "")));
                          const textColor = tk && !hasBadge ? "text-amber-500" : "text-foreground";
                          if (!start && !end || isAbsence(s.activity)) {
                            return (
                              <li key={s.id} className={`text-[12px] leading-snug ${textColor}`}>
                                {renderActivityWithBadge(s.activity)}
                              </li>
                            );
                          }
                          return (
                            <li key={s.id} className={`text-[12px] leading-snug ${textColor}`}>
                              <span className="font-mono tabular-nums text-cyan-400">
                                {start ?? "—"} → {end ?? "—"}
                              </span>
                              <span className="mx-1.5 text-muted-foreground">|</span>
                              {renderActivityWithBadge(s.activity)}
                            </li>
                          );
                        })}
                        {onlyAbsence ? null : null}
                      </ul>
                    )}
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
