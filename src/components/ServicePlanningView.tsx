// V1 simple : tableau brut salarié × jour, regroupé par semaine.
// Aucune normalisation, aucune interprétation, aucun calcul.
// On affiche uniquement le texte tel que retourné par l'extraction du PDF
// (raw_text ou activity), sans tri ni mise en forme par type d'absence.

import { useState } from "react";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { getTodayUTC, weekStartUTC } from "@/lib/utils";

type ServiceEvent = {
  employee: string;
  date: string | null;
  start_time?: string | null;
  end_time?: string | null;
  all_day?: boolean;
  activity?: string | null;
  raw_text?: string | null;
  event_type?: string | null;
  confidence?: string | null;
};

const DAYS_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(date.getTime()) ? null : date;
}

function formatDayHeader(iso: string): string {
  const d = parseDate(iso);
  if (!d) return iso;
  return `${DAYS_SHORT[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(
    d.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

function formatShortDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

// ISO 8601 week number
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / MS_PER_DAY) + 1) / 7);
}

function cellText(e: ServiceEvent): string {
  const raw = (e.raw_text ?? "").trim();
  const text = raw || (e.activity ?? "").trim();
  if (!text) return "";
  const lines = text.split(/\n/);

  // Conservative dedup: only collapse runs of 3+ identical consecutive lines.
  const deduped: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let j = i;
    while (j < lines.length && lines[j].trim() === lines[i].trim()) j++;
    const runLength = j - i;
    if (runLength >= 3) {
      deduped.push(lines[i]);
    } else {
      for (let k = i; k < j; k++) deduped.push(lines[k]);
    }
    i = j;
  }

  return deduped.join("\n");
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Préfixe horaire en début de cellule (ex. "09h00-13h00", ou avec décompte de
// pause "13h30-17h00 (-01h00)"). Affiché dans une couleur neutre dédiée pour
// le distinguer visuellement de l'activité qui suit.
const TIME_PREFIX_RE = /^(\d{1,2}[hH:]\d{2})\s*-\s*(\d{1,2}[hH:]\d{2})\s*(\(-?\d{1,2}h\d{2}\))?\s*/;

// Badges visuels pour statuts courts (ne modifie pas le texte affiché — on
// surligne juste les mots-clés présents dans la cellule). Les clés sont
// comparées sans accents (insensible aux accents et à la casse) pour
// fonctionner peu importe la façon dont le PDF source les a écrits.
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

function renderCellContent(text: string) {
  const timeMatch = text.match(TIME_PREFIX_RE);

  const timeLabel = timeMatch ? timeMatch[0].trim() : null;

  const rest = timeMatch ? text.slice(timeMatch[0].length) : text;

  const restNoAccents = stripAccents(rest);

  const timeNode = timeLabel ? (
    <span className="font-medium text-cyan-400">{timeLabel}</span>
  ) : null;

  for (const b of STATUS_BADGES) {
    const pattern = `\\b${b.key.replace(/ /g, "\\s+")}\\b`;
    const re = new RegExp(pattern, "i");
    if (re.test(restNoAccents)) {
      // "RH" est ambigu : il apparaît dans "Responsable RH". On ne le traite
      // comme badge que s'il est seul sur sa ligne (ou seul dans la cellule).
      if (b.key === "RH") {
        const standalone = restNoAccents.split(/\r?\n/).some((l) => /^\s*RH\s*$/i.test(l));
        if (!standalone) continue;
      }
      const cleaned = stripBadgeText(rest, b.key);

      const badgeNode = (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
          {b.label.toUpperCase()}
        </span>
      );

      return (
        <div className="flex flex-wrap items-center gap-1">
          {timeNode}
          {badgeNode}
          {cleaned && <span className="whitespace-pre-wrap break-words">{cleaned}</span>}
        </div>
      );
    }
  }

  if (!timeNode) {
    return <span className="whitespace-pre-wrap break-words">{text}</span>;
  }

  return (
    <div className="flex flex-wrap items-baseline gap-1">
      {timeNode}
      {rest.trim() && <span className="whitespace-pre-wrap break-words">{rest.trim()}</span>}
    </div>
  );
}

// ---- Cumul d'heures hebdomadaire par salarié (basé sur start_time/end_time) ----

const PAID_LEAVE_MINUTES: Record<string, number> = {
  RTT_EMPLOYEUR: 468, // 7h48
  RECUPERATION_SALARIE: 468, // 7h48, même règle que RTT salarié
};

function getPaidLeaveMinutes(activity: string | null | undefined): number {
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

// Extrait le décompte de pause "(-01h00)" présent dans le texte d'activité
// d'un shift, en minutes. Ce décompte doit être soustrait de la durée brute
// du créneau horaire (ex. "13h30-17h00 (-01h00)" = 2h30 réelles, pas 3h30).
function getBreakDeductionMinutes(activity: string | null | undefined): number {
  if (!activity) return 0;
  const m = activity.match(/\(\s*-\s*(\d{1,2})\s*[hH:]\s*(\d{2})\s*\)/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Les heures de voyage font l'objet d'un taux différent en paie : elles ne
// doivent jamais être additionnées au temps de travail normal.
function isVoyageActivity(activity: string | null | undefined): boolean {
  if (!activity) return false;
  return /\bvoyage\b/i.test(stripAccents(activity));
}

function minutesOf(start: string | null | undefined, end: string | null | undefined, activity: string | null | undefined): number {
  const paidMinutes = getPaidLeaveMinutes(activity);
  if (paidMinutes > 0) return paidMinutes;
  if (!start || !end) return 0;
  const sm = start.match(/^(\d{1,2}):(\d{2})/);
  const em = end.match(/^(\d{1,2}):(\d{2})/);
  if (!sm || !em) return 0;
  const s = parseInt(sm[1], 10) * 60 + parseInt(sm[2], 10);
  let e = parseInt(em[1], 10) * 60 + parseInt(em[2], 10);
  if (e < s) e += 24 * 60;
  const breakMin = getBreakDeductionMinutes(activity);
  return Math.max(0, e - s - breakMin);
}

function fmtWeeklyDuration(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

// Calcule, pour un salarié donné, deux totaux séparés sur l'ensemble des
// events fournis (déjà filtrés sur la semaine affichée par l'appelant) :
// le temps de travail normal (work) et le temps de voyage (voyage), jamais
// additionnés entre eux car ils relèvent de taux de paie différents.
// Retourne null si le salarié n'a aucun shift avec horaires (cas FJ).
function computeWeeklyMinutes(events: ServiceEvent[], employee: string): { work: number; voyage: number } | null {
  let work = 0;
  let voyage = 0;
  let hasTimedShift = false;
  for (const e of events) {
    if ((e?.employee ?? "").trim() !== employee) continue;
    const paid = getPaidLeaveMinutes(e.activity);
    if (paid > 0) {
      work += paid;
      hasTimedShift = true;
      continue;
    }
    if (e.start_time && e.end_time) {
      const mins = minutesOf(e.start_time, e.end_time, e.activity);
      if (isVoyageActivity(e.activity)) voyage += mins;
      else work += mins;
      hasTimedShift = true;
    }
  }
  return hasTimedShift ? { work, voyage } : null;
}

function WeekTable({ events }: { events: ServiceEvent[] }) {
  const datesSet = new Set<string>();
  const empSet = new Set<string>();
  for (const e of events) {
    if (e?.date) datesSet.add(e.date);
    const name = (e?.employee ?? "").trim();
    if (name) empSet.add(name);
  }
  const dates = Array.from(datesSet).sort((a, b) => a.localeCompare(b));
  const employees = Array.from(empSet).sort((a, b) => a.localeCompare(b, "fr"));

  const cells = new Map<string, string[]>();
  for (const e of events) {
    const name = (e?.employee ?? "").trim();
    const date = e?.date ?? "";
    if (!name || !date) continue;
    const key = `${name}__${date}`;
    const txt = cellText(e);
    if (!txt) continue;
    const arr = cells.get(key) ?? [];
    arr.push(txt);
    cells.set(key, arr);
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/60">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="sticky left-0 z-10 border-b border-r border-border/60 bg-muted px-2 py-1.5 text-left font-semibold shadow-[1px_0_0_0_hsl(var(--border))]">
              Salarié
            </th>
            {dates.map((d) => (
              <th
                key={d}
                className="border-b border-r border-border/60 px-2 py-1.5 text-left font-semibold whitespace-nowrap"
              >
                {formatDayHeader(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            const weekly = computeWeeklyMinutes(events, emp);
            return (
              <tr key={emp} className="align-top">
                <td className="sticky left-0 z-10 border-b border-r border-border/60 bg-card px-2 py-1 font-medium whitespace-nowrap shadow-[1px_0_0_0_hsl(var(--border))]">
                  <div className="flex items-center gap-1.5">
                    <span>{emp}</span>
                    {weekly && weekly.work > 0 && (
                      <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        {fmtWeeklyDuration(weekly.work)}
                      </span>
                    )}
                    {weekly && weekly.voyage > 0 && (
                      <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">
                        Voyage {fmtWeeklyDuration(weekly.voyage)}
                      </span>
                    )}
                  </div>
                </td>
                {dates.map((d) => {
                  const arr = cells.get(`${emp}__${d}`) ?? [];
                  return (
                    <td
                      key={d}
                      className="border-b border-r border-border/60 px-2 py-1 align-top"
                    >
                      {arr.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="space-y-0.5">
                          {arr.map((t, i) => (
                            <div key={i}>{renderCellContent(t)}</div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Vue mobile (cartes empilées, deux modes : par jour / par employé) ----

// Détecte si une cellule ne contient qu'un statut "repos" sans activité
// (RH ou RTT seuls), pour regrouper ces salariés dans une ligne discrète
// plutôt que de leur donner une carte pleine dans la vue "Par jour".
function isRestOnly(text: string): boolean {
  const t = stripAccents(text.trim().replace(/\s*\n\s*/g, " ").replace(/\s+/g, " "));

  const timeRanges = [...t.matchAll(/(\d{1,2})[hH:](\d{2})\s*[-–]\s*(\d{1,2})[hH:](\d{2})/g)];

  const hasRealShift = timeRanges.some(m => !(parseInt(m[3]) === 23 && parseInt(m[4]) === 59));

  if (hasRealShift) return false;

  return /\b(RH|JNT|RTT|CONGES?|CONGES? MATERNITE|CONGES? PATERNITE|ABSENCE MALADIE|ABSENCES? A REGULARISER|ACCIDENT DU TRAVAIL|RECUPERATION SALARIES?|RECUPERATION COLLAB|RTT EMPLOYEUR|RTT SALARIE|CP)\b/i.test(t);
}



function MobileWeekView({ events }: { events: ServiceEvent[] }) {
  const datesSet = new Set<string>();
  const empSet = new Set<string>();
  for (const e of events) {
    if (e?.date) datesSet.add(e.date);
    const name = (e?.employee ?? "").trim();
    if (name) empSet.add(name);
  }
  const dates = Array.from(datesSet).sort((a, b) => a.localeCompare(b));
  const employees = Array.from(empSet).sort((a, b) => a.localeCompare(b, "fr"));

  const cells = new Map<string, string[]>();
  for (const e of events) {
    const name = (e?.employee ?? "").trim();
    const date = e?.date ?? "";
    if (!name || !date) continue;
    const key = `${name}__${date}`;
    const txt = cellText(e);
    if (!txt) continue;
    const arr = cells.get(key) ?? [];
    arr.push(txt);
    cells.set(key, arr);
  }

  const todayIso = (() => {
    const t = getTodayUTC();
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  })();
  const defaultDayIndex = Math.max(0, dates.indexOf(todayIso));

  const [mode, setMode] = useState<"day" | "employees">("day");
  const [selectedDayIdx, setSelectedDayIdx] = useState(defaultDayIndex);
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);

  const selectedDate = dates[selectedDayIdx];

  const dayRows = employees
    .map((emp) => ({ emp, texts: cells.get(`${emp}__${selectedDate}`) ?? [] }))
    .filter((r) => r.texts.length > 0);
  const dayWorking = dayRows.filter((r) => !(r.texts.length === 1 && isRestOnly(r.texts[0])));
  const dayResting = dayRows.filter((r) => r.texts.length === 1 && isRestOnly(r.texts[0]));

  return (
    <div className="space-y-4">
      {/* Sélecteur de mode */}
      <div className="flex gap-1 rounded-xl bg-muted p-1">
        <button
          onClick={() => setMode("day")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            mode === "day" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          Par jour
        </button>
        <button
          onClick={() => {
            setMode("employees");
            setSelectedEmployee(null);
          }}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            mode === "employees" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          Par employé
        </button>
      </div>

      {mode === "day" && (
        <div className="space-y-3">
          {/* Sélecteur de jour horizontal */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {dates.map((d, i) => (
              <button
                key={d}
                onClick={() => setSelectedDayIdx(i)}
                className={`flex-shrink-0 rounded-lg border px-3 py-2 text-xs font-medium whitespace-nowrap ${
                  i === selectedDayIdx
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/60 bg-card text-muted-foreground"
                }`}
              >
                {formatDayHeader(d)}
              </button>
            ))}
          </div>

          {dayWorking.length === 0 ? (
            <div className="rounded-2xl border border-border/60 p-4 text-center text-sm text-muted-foreground">
              Personne ne travaille ce jour.
            </div>
          ) : (
            <>
              <p className="text-xs font-medium text-muted-foreground">
                {dayWorking.length} salarié{dayWorking.length > 1 ? "s" : ""} ce jour
              </p>
              <div className="space-y-2">
                {dayWorking.map(({ emp, texts }) => (
                  <div
                    key={emp}
                    className="rounded-2xl border border-border/60 bg-card p-3 space-y-1"
                  >
                    <p className="text-sm font-semibold">{emp}</p>
                    <div className="space-y-0.5">
                      {texts.map((t, i) => (
                        <div key={i}>{renderCellContent(t)}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {dayResting.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Absences / Repos : {dayResting.map((r) => r.emp).join(", ")}
            </p>
          )}
        </div>
      )}

      {mode === "employees" && !selectedEmployee && (
        <div className="space-y-2">
          {employees.map((emp) => {
            const weekly = computeWeeklyMinutes(events, emp);
            return (
              <button
                key={emp}
                type="button"
                onClick={() => setSelectedEmployee(emp)}
                className="flex w-full items-center justify-between rounded-2xl border border-border/60 bg-card p-3 text-left font-medium"
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  {emp}
                  {weekly && weekly.work > 0 && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {fmtWeeklyDuration(weekly.work)}
                    </span>
                  )}
                  {weekly && weekly.voyage > 0 && (
                    <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">
                      Voyage {fmtWeeklyDuration(weekly.voyage)}
                    </span>
                  )}
                </span>
                <span className="text-muted-foreground">›</span>
              </button>
            );
          })}
        </div>
      )}

      {mode === "employees" && selectedEmployee && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setSelectedEmployee(null)}
            className="text-sm font-medium text-primary"
          >
            ‹ Retour
          </button>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-display text-base font-semibold">{selectedEmployee}</p>
            {(() => {
              const weekly = computeWeeklyMinutes(events, selectedEmployee);
              if (!weekly) return null;
              return (
                <>
                  {weekly.work > 0 && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      {fmtWeeklyDuration(weekly.work)}
                    </span>
                  )}
                  {weekly.voyage > 0 && (
                    <span className="rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">
                      Voyage {fmtWeeklyDuration(weekly.voyage)}
                    </span>
                  )}
                </>
              );
            })()}
          </div>
          <div className="space-y-2">
            {dates.map((d) => {
              const texts = cells.get(`${selectedEmployee}__${d}`) ?? [];
              return (
                <div
                  key={d}
                  className="rounded-2xl border border-border/60 bg-card p-3 space-y-1"
                >
                  <p className="text-xs font-medium text-muted-foreground">
                    {formatDayHeader(d)}
                  </p>
                  {texts.length === 0 ? (
                    <span className="text-sm text-muted-foreground">—</span>
                  ) : (
                    <div className="space-y-0.5">
                      {texts.map((t, i) => (
                        <div key={i}>{renderCellContent(t)}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Affiche le tableau classique sur desktop (md:block) et les cartes mobiles
// en dessous de md (md:hidden), sans dupliquer la logique de regroupement —
// chaque vue reconstruit ses propres cellules à partir des mêmes events.
function WeekContent({ events }: { events: ServiceEvent[] }) {
  return (
    <>
      <div className="hidden md:block">
        <WeekTable events={events} />
      </div>
      <div className="md:hidden">
        <MobileWeekView events={events} />
      </div>
    </>
  );
}

type WeekGroup = {
  wsTime: number;
  weekStart: Date;
  weekEnd: Date;
  weekNumber: number;
  employeeCount: number;
  events: ServiceEvent[];
};

function WeekHeader({ g }: { g: WeekGroup }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-left">
      <span className="font-display text-base font-semibold">Semaine {g.weekNumber}</span>
      <span className="text-xs text-muted-foreground">
        du {formatShortDate(g.weekStart)} au {formatShortDate(g.weekEnd)}
      </span>
      <span className="text-xs text-muted-foreground">
        · {g.employeeCount} salarié{g.employeeCount > 1 ? "s" : ""}
      </span>
    </div>
  );
}

export function ServicePlanningView({ events, weekStart }: { events: ServiceEvent[]; weekStart?: string | null }) {
  if (!events.length) {
    return (
      <div className="rounded-2xl border border-border/60 p-6 text-center text-sm text-muted-foreground">
        Aucun planning du service disponible. Importez un PDF pour afficher le tableau brut.
      </div>
    );
  }

  // Regroupement par semaine (lundi UTC)
  const groupsMap = new Map<number, WeekGroup>();
  for (const e of events) {
    const d = parseDate(e?.date ?? null);
    if (!d) continue;
    const ws = weekStartUTC(d);
    const t = ws.getTime();
    let g = groupsMap.get(t);
    if (!g) {
      const weekEnd = new Date(t + 6 * MS_PER_DAY);
      g = {
        wsTime: t,
        weekStart: ws,
        weekEnd,
        weekNumber: isoWeekNumber(ws),
        employeeCount: 0,
        events: [],
      };
      groupsMap.set(t, g);
    }
    g.events.push(e);
  }

  // Calcul employés par semaine
  for (const g of groupsMap.values()) {
    const empSet = new Set<string>();
    for (const e of g.events) {
      const name = (e?.employee ?? "").trim();
      if (name) empSet.add(name);
    }
    g.employeeCount = empSet.size;
  }

  const currentWs = weekStartUTC(getTodayUTC()).getTime();
  const nextWs = currentWs + 7 * MS_PER_DAY;

  const current: WeekGroup[] = [];
  const next: WeekGroup[] = [];
  const past: WeekGroup[] = [];
  for (const g of groupsMap.values()) {
    if (g.wsTime === currentWs) current.push(g);
    else if (g.wsTime === nextWs) next.push(g);
    else past.push(g);
  }
  // Anciennes : plus récente -> plus ancienne
  past.sort((a, b) => b.wsTime - a.wsTime);

  return (
    <div className="space-y-6">
      {/* Semaine en cours — ouverte par défaut */}
      <section className="space-y-3">
        <h3 className="font-display text-lg font-semibold">Semaine en cours</h3>
        {current.length === 0 ? (
          <div className="rounded-2xl border border-border/60 p-6 text-center text-sm text-muted-foreground">
            Aucun planning de service pour la semaine en cours.
          </div>
        ) : (
          current.map((g) => (
            <div key={g.wsTime} className="space-y-2">
              <WeekHeader g={g} />
              <WeekContent events={g.events} />
            </div>
          ))
        )}
      </section>

      {/* Semaine suivante — ouverte par défaut si présente */}
      {next.length > 0 && (
        <section className="space-y-3 border-t border-border/60 pt-6">
          <h3 className="font-display text-lg font-semibold">Semaine suivante</h3>
          {next.map((g) => (
            <div key={g.wsTime} className="space-y-2">
              <WeekHeader g={g} />
              <WeekContent events={g.events} />
            </div>
          ))}
        </section>
      )}

      {/* Anciennes semaines — repliées par défaut */}
      {past.length > 0 && (
        <section className="space-y-3 border-t border-border/60 pt-6">
          <h3 className="font-display text-lg font-semibold">Anciennes semaines</h3>
          <Accordion type="multiple" className="space-y-2">
            {past.map((g) => (
              <AccordionItem
                key={g.wsTime}
                value={String(g.wsTime)}
                className="rounded-2xl border border-border/60 px-4"
              >
                <AccordionTrigger className="py-3 hover:no-underline">
                  <WeekHeader g={g} />
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <WeekContent events={g.events} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      )}
    </div>
  );
}
