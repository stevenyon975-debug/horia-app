import { Calendar, Clock } from "lucide-react";
import { cleanActivityPrefix } from "@/lib/utils";

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
  RTT_EMPLOYEUR: 468,
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

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function renderActivityWithBadge(activity: string | null) {
  if (!activity) return <span className="break-words font-semibold">—</span>;
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
      const label = (b.label ?? b.key).toUpperCase();
      const cleaned = textNoAccents.replace(new RegExp(`\\b${b.key.replace(/ /g, "\\s+")}\\b`, "gi"), "").replace(/\s+/g, " ").trim();
      if (!cleaned) {
        return (
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
            {label}
          </span>
        );
      }
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>
            {label}
          </span>
          <span className="break-words font-semibold">{cleaned}</span>
        </span>
      );
    }
  }
  return <span className="break-words font-semibold">{text}</span>;
}

export function DayDetailView({
  dateStr,
  items,
}: {
  dateStr: string;
  items: ShiftRow[];
}) {
  const date = parseDate(dateStr);

  return (
    <div className="space-y-2">
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

      {items.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-6 text-center text-sm text-muted-foreground">
          Aucun créneau ce jour.
        </div>
      ) : (
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
      )}
    </div>
  );
}
