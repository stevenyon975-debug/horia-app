import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getDocumentProxy } from "unpdf";

type Item = { str: string; x: number; y: number };
type DayCol = { date: Date | null; dayIndex: number; x: number; xEnd: number; headerY: number };
type EmployeeBand = { name: string; yTop: number; yBottom: number; x: number };
type ParsedShift = {
  shift_date: string | null;
  start_time: string | null;
  end_time: string | null;
  activity: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
  raw_line: string | null;
};

export type DiagnosticCell = {
  employee: string;
  date: string | null;
  dayIndex: number;
  x: number;
  xEnd: number;
  yTop: number;
  yBottom: number;
  text: string;
};

export type LeftCandidate = {
  text: string;
  x: number;
  y: number;
  accepted: boolean;
  reason: string;
  score: number;
};

export type RowBand = { y: number; itemCount: number; sample: string };

export type DiagnosticPage = {
  page: number;
  weekStart: string | null;
  pageWidth: number;
  pageHeight: number;
  headerY: number | null;
  firstColX: number | null;
  totalItems: number;
  allItems: { str: string; x: number; y: number }[];
  rowBands: RowBand[];
  leftCandidates: LeftCandidate[];
  dayColumns: { date: string | null; dayIndex: number; x: number; xEnd: number }[];
  employees: { name: string; yTop: number; yBottom: number; x: number; isUser: boolean }[];
  primaryEmployee: string | null;
  cells: DiagnosticCell[];
  matchedUser: string | null;
};

const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const IGNORED = /\b(tableau de service|previsionnel|page|semaine|confirme|circonstances|besoins du service|heure de saint|st pierre|france)\b/i;
// Activity / business keywords that must NEVER be treated as an employee name.
const ACTIVITY_KEYWORDS = /\b(fab|r[ée]gie|mixage|jt|midi|soir|matin|rtt|employeur|r[ée]union|maintenance|habillage|ops|cong[ée]s|service|prise|antenne|d[ée]cor|plateau|montage|trafic|news|info|sport|m[ée]t[ée]o|reportage|tournage|direct|studio|loge|salle)\b/i;
const TIME_TOKEN = /\b\d{1,2}\s*[h:H]\s*\d{2}\b|\b\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?\b/;
const DAY_HEADER_RE = new RegExp(`^(${DAY_NAMES.join("|")})\\b`, "i");
const WEEKLY_HOURS_RE = /\b(\d{1,2})\s*h\s*(\d{2})?\b(?!\s*[-–])/i;
const TIME_RANGE_RE = /\d{1,2}\s*[h:]\s*\d{2}\s*[-–]\s*\d{1,2}\s*[h:]\s*\d{2}/i;
const SECTION_HEADER_RE = /^\d+\.\s*[A-ZÀ-ÝŒ]/;
const SURNAME_ONLY_RE = /^[A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\- ]*$/;
const FIRSTNAME_FJ_RE = /^([A-ZÀ-ÝŒ][a-zà-ÿœ'\-]+(?:\s+[a-zà-ÿœ'\-]+){0,2})\s+FJ\b/;
const GOLD_PATTERN_REDACTION =
  /^([A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\-]{1,}(?:\s+[A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\-]+)*)\s+([A-ZÀ-ÝŒ][a-zà-ÿœ'\-]+(?:\s+[a-zà-ÿœ'\-]+){0,2})\s+FJ\b/;
// Column headers found in France Télévisions planning tables — never employees.
const COLUMN_HEADER_RE = /^\s*(nom|nb|ott)(\s+(nom|nb|ott))*\s*$/i;
// Matches a leading uppercase token (potential lastname) at the start of a row.
const LEADING_UPPER_RE = /^([A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\-]{1,})\b/;
// Matches "Firstname XXhXX" at the start of a row (the firstname + weekly-total continuation).
const FIRSTNAME_WEEKLY_RE = /^([A-ZÀ-ÝŒ][a-zà-ÿœ'\-]+)\s+(\d{1,2})\s*h\s*(\d{2})?\b/;

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s\/.\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fmtDateISO(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function fmtTime(h: string, m: string) {
  return `${String(Math.min(parseInt(h, 10), 23)).padStart(2, "0")}:${String(Math.min(parseInt(m, 10), 59)).padStart(2, "0")}:00`;
}

async function loadPageItems(buffer: Uint8Array): Promise<Item[][]> {
  const pdf = await getDocumentProxy(buffer);
  const pages: Item[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items: Item[] = [];
    for (const it of content.items as any[]) {
      if (!("str" in it) || !it.str || !it.str.trim()) continue;
      items.push({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] });
    }
    pages.push(items);
  }
  return pages;
}

function parseWeekStart(allText: string): Date | null {
  const m = allText.match(/du\s+(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\s+au/i);
  if (!m) return null;
  let y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  return new Date(Date.UTC(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)));
}

export async function extractGridLines(page: any): Promise<number[]> {
  const ops = await page.getOperatorList();

  let lastTransform = [1, 0, 0, 1, 0, 0];

  const linesByY = new Map<number, { totalW: number }>();

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];

    if (fn === 12) { lastTransform = ops.argsArray[i]; continue; }

    if (fn !== 91) continue;

    const [, rawC] = ops.argsArray[i];

    const coords: number[] = typeof rawC[0] === 'object' && !Array.isArray(rawC[0])
      ? Object.values(rawC[0]) as number[]
      : rawC as number[];

    const [, , , , tx, ty] = lastTransform;

    const MOVETO = 0, LINETO = 1;

    let ci = 0;

    const pts: { x: number; y: number }[] = [];

    while (ci < coords.length) {
      const op = coords[ci++];

      if (op === MOVETO || op === LINETO) pts.push({ x: coords[ci++] + tx, y: coords[ci++] + ty });

      else break;
    }

    if (pts.length < 2) continue;

    const ys = pts.map(p => p.y);
    const xs = pts.map(p => p.x);

    const h = Math.max(...ys) - Math.min(...ys);
    const w = Math.max(...xs) - Math.min(...xs);

    if (h < 1 && w > 100) {
      const yKey = Math.round(Math.min(...ys) * 10) / 10;
      const cur = linesByY.get(yKey) ?? { totalW: 0 };
      cur.totalW += w;
      linesByY.set(yKey, cur);
    }
  }

  return [...linesByY.entries()]
    .filter(([, d]) => d.totalW > 400)
    .map(([y]) => y)
    .sort((a, b) => b - a);
}

function detectDayColumns(items: Item[], weekStart: Date | null): DayCol[] | null {
  const candidates: { x: number; y: number; dayIndex: number; date: Date | null }[] = [];
  for (const it of items) {
    const n = normalize(it.str);
    for (let di = 0; di < 7; di++) {
      if (!n.startsWith(DAY_NAMES[di])) continue;
      const dm = it.str.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
      let date: Date | null = null;
      if (dm) {
        let y = dm[3] ? parseInt(dm[3], 10) : weekStart?.getUTCFullYear() ?? new Date().getUTCFullYear();
        if (y < 100) y += 2000;
        date = new Date(Date.UTC(y, parseInt(dm[2], 10) - 1, parseInt(dm[1], 10)));
      } else if (weekStart) {
        const d = new Date(weekStart);
        d.setUTCDate(d.getUTCDate() + di);
        date = d;
      }
      candidates.push({ x: it.x, y: it.y, dayIndex: di, date });
      break;
    }
  }
  if (candidates.length < 3) return null;

  const groups: { y: number; items: typeof candidates }[] = [];
  for (const c of candidates) {
    const g = groups.find((g) => Math.abs(g.y - c.y) <= 3);
    if (g) g.items.push(c);
    else groups.push({ y: c.y, items: [c] });
  }
  groups.sort((a, b) => b.items.length - a.items.length);
  const best = groups[0].items;
  if (best.length < 3) return null;

  const seen = new Set<number>();
  const sorted = best
    .filter((c) => (seen.has(c.dayIndex) ? false : (seen.add(c.dayIndex), true)))
    .sort((a, b) => a.x - b.x);

  const boundaries: number[] = [];
  boundaries[0] = sorted[0].x - (sorted[1].x - sorted[0].x) / 3;
  for (let i = 1; i < sorted.length; i++) {
    boundaries[i] = (sorted[i - 1].x + sorted[i].x) / 2;
  }
  boundaries[sorted.length] = Infinity;

  const headerYVal = Math.max(...sorted.map(c => c.y));
  const datePattern = /^\d{1,2}\/\d{2}$/;
  const dateRowItems = items.filter(it =>
    datePattern.test(it.str.trim()) &&
    it.y < headerYVal &&
    it.y > headerYVal - 20
  );
  const secondHeaderY = dateRowItems.length >= 3
    ? dateRowItems.reduce((sum, it) => sum + it.y, 0) / dateRowItems.length
    : null;

  return sorted.map((c, i) => ({
    date: c.date,
    dayIndex: c.dayIndex,
    x: boundaries[i],
    xEnd: boundaries[i + 1],
    headerX: c.x,
    headerY: c.y,
    secondHeaderY,
  }));
}

// Group left-column items by Y row, merge vertically-adjacent name fragments
// ("CHOI" + "Dimitry 39h48"), then evaluate each row as a possible employee.
function detectEmployeesWithReasons(
  items: Item[],
  headerY: number,
  firstColX: number,
  secondHeaderYParam: number | null = null,
  gridLines: number[] = [],
): {
  bands: EmployeeBand[];
  candidates: LeftCandidate[];
  rowBands: RowBand[];
  primary: string | null;
} {
  // Anything left of the first day column AND below the day-header row.
  const left = items.filter((it) => it.x < firstColX - 2 && it.y < headerY - 1);

  // First pass: cluster items by Y (tol 2px).
  type Row = { y: number; items: Item[] };
  const rows: Row[] = [];
  for (const it of left) {
    const r = rows.find((r) => Math.abs(r.y - it.y) <= 2);
    if (r) r.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  rows.sort((a, b) => b.y - a.y); // top → bottom (PDF: higher y = upper)

  // Second pass: merge a row whose LEADING token is an all-caps lastname
  // ("CHOI", or "YON service 15H") with the very next row below it (dy ≤ 14)
  // when that next row starts with "Firstname XXhXX". This rebuilds split
  // employee lines like:
  //   "CHOI"            +  "Dimitry 39h48 H 15h00-15h30"   → "CHOI Dimitry 39h48 …"
  //   "YON service 15H" +  "Steven 39h48 H"                → "YON Steven 39h48 H"
  const merged: Row[] = [];
  let i = 0;
  while (i < rows.length) {
    const cur = rows[i];
    const next = rows[i + 1];
    const curSorted = cur.items.slice().sort((a, b) => a.x - b.x);
    const nextSorted = next ? next.items.slice().sort((a, b) => a.x - b.x) : [];
    const curText = curSorted.map((x) => x.str).join(" ").trim();
    const nextText = nextSorted.map((x) => x.str).join(" ").trim();
    const dy = next ? cur.y - next.y : Infinity;

    const leadingUpper = curText.match(LEADING_UPPER_RE)?.[1] ?? null;
    const nextStartsFirstnameWeekly =
      nextText && FIRSTNAME_WEEKLY_RE.test(nextText) && !TIME_RANGE_RE.test(nextText.split(/\s+/).slice(0, 3).join(" "));

    // Path A: original "CHOI" lastname-only row + "Dimitry 39h48 …" row.
    const curIsLastnameOnly =
      curText.length <= 24 &&
      /^[A-ZÀ-ÝŒ'\- ]+$/.test(curText) &&
      (!ACTIVITY_KEYWORDS.test(curText) || FIRSTNAME_FJ_RE.test(curText));
    const nextHasWeekly =
      nextText && WEEKLY_HOURS_RE.test(nextText) && !TIME_RANGE_RE.test(nextText);

    if (curIsLastnameOnly && nextHasWeekly && dy > 0 && dy <= 14) {
      const afterNext = rows[i + 2];
      const dyAfterNext = afterNext ? next.y - afterNext.y : Infinity;
      if (afterNext && dyAfterNext > 0 && dyAfterNext <= 14) {
        const afterNextSorted = afterNext.items.slice().sort((a, b) => a.x - b.x);
        const afterNextText = afterNextSorted.map((x) => x.str).join(" ").trim();
        if (/^[A-ZÀ-ÝŒ][a-zà-ÿœ'\-]+$/.test(afterNextText)) {
          merged.push({ y: afterNext.y, items: [...cur.items, ...next.items, ...afterNext.items] });
          i += 3;
          continue;
        }
      }
      merged.push({ y: next.y, items: [...cur.items, ...next.items] });
      i += 2;
      continue;
    }

    // Path B: "YON service 15H" (leading all-caps + activity noise) + "Steven 39h48 H".
    // Take ONLY the leading uppercase item from cur and combine with all of next.
    if (leadingUpper && nextStartsFirstnameWeekly && dy > 0 && dy <= 14) {
      const leadItem = curSorted.find((it) => it.str.startsWith(leadingUpper));
      if (leadItem) {
        merged.push({ y: next.y, items: [leadItem, ...next.items] });
        i += 2;
        continue;
      }
    }

    // Path C: rédaction "NOM" (nom de famille seul, majuscules) +
    // "Prénom FJ ..." → fusionne en "NOM Prénom".
    const curIsSurnameOnlyRedaction =
      curText.length <= 30 &&
      SURNAME_ONLY_RE.test(curText.split(' ')[0]) &&
      !SECTION_HEADER_RE.test(curText) &&
      (!ACTIVITY_KEYWORDS.test(curText) || FIRSTNAME_FJ_RE.test(curText));
    const nextFirstnameFJ = nextText.match(FIRSTNAME_FJ_RE);
    if (curIsSurnameOnlyRedaction && nextFirstnameFJ && dy > 0 && dy <= 14) {
      merged.push({ y: cur.y, items: [...cur.items, ...next.items] });
      i += 2;
      continue;
    }

    merged.push(cur);
    i += 1;
  }

  const rowBands: RowBand[] = merged.map((r) => ({
    y: r.y,
    itemCount: r.items.length,
    sample: r.items
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((it) => it.str)
      .join(" ")
      .slice(0, 80),
  }));

  const candidates: LeftCandidate[] = [];
  type Accepted = { name: string; y: number; x: number; score: number };
  const accepted: Accepted[] = [];

  // Gold pattern: line STARTS with "NOM[ NOM2...] Prénom XXhXX".
  // Once this prefix matches, the row is an employee — any trailing text
  // (including time ranges like "15h00-15h30") is ignored for name purposes.
  const GOLD_PATTERN =
    /^([A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\-]{1,}(?:\s+[A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\-]+)*)\s+([A-ZÀ-ÝŒ][a-zà-ÿœ'\-]+(?:\s+[A-ZÀ-ÝŒ][a-zà-ÿœ'\-]+)?)\s+(\d{1,2})\s*h\s*(\d{2})\b/;

  for (const r of merged) {
    const sorted = r.items.slice().sort((a, b) => a.x - b.x);
    const text = sorted.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim();
    const x = sorted[0]?.x ?? 0;
    const base = { text, x, y: r.y };


    // Hard reject: column-header row "Nom Nb OTT" (or any subset/order of those tokens).
    if (COLUMN_HEADER_RE.test(text)) {
      candidates.push({ ...base, accepted: false, reason: "en-tête de colonne (Nom/Nb/OTT)", score: 0 });
      continue;
    }

    // Rejet : en-tête de section rédaction ("1. ENCADREMENT...", "3. REDACTEURS"...)
    if (SECTION_HEADER_RE.test(text)) {
      candidates.push({ ...base, accepted: false, reason: "en-tête de section (rédaction)", score: 0 });
      continue;
    }

    // 1) Gold-pattern fast path — bypasses time-range / activity-keyword rejection.
    const gold = text.match(GOLD_PATTERN);
    if (gold) {
      const displayName = `${gold[1]} ${gold[2]}`.replace(/\s+/g, " ").trim();
      if (accepted.some((a) => a.name === displayName && Math.abs(a.y - r.y) < 3)) {
        candidates.push({ ...base, accepted: false, reason: "doublon", score: 3 });
        continue;
      }
      const reason = `employé GOLD (NOM + Prénom + ${gold[3]}h${gold[4]})`;
      accepted.push({ name: displayName, y: r.y, x, score: 3 });
      candidates.push({ ...base, accepted: true, reason, score: 3 });
      continue;
    }

    const goldRed = text.match(GOLD_PATTERN_REDACTION);
    if (goldRed) {
      const displayName = `${goldRed[1]} ${goldRed[2]}`.replace(/\s+/g, " ").trim();
      if (accepted.some((a) => a.name === displayName && Math.abs(a.y - r.y) < 3)) {
        candidates.push({ ...base, accepted: false, reason: "doublon", score: 3 });
        continue;
      }
      accepted.push({ name: displayName, y: r.y, x, score: 3 });
      candidates.push({ ...base, accepted: true, reason: "employé GOLD rédaction (NOM + Prénom + FJ)", score: 3 });
      continue;
    }

    // Format CDD : NOM PRENOM entièrement en MAJUSCULES + total horaire
    // (ex. "GORIS ANDREA 29h H", "LE BARS MARC 35h30 H")
    const GOLD_PATTERN_FULL_UPPER = /^([A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\-]+(?:\s+[A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\-]+)+)\s+(\d{1,2})\s*h\s*(\d{2})?\b/;

    const goldFullUpper = text.match(GOLD_PATTERN_FULL_UPPER);
    if (goldFullUpper) {
      const displayName = goldFullUpper[1].replace(/\s+/g, " ").trim();
      if (accepted.some((a) => a.name === displayName && Math.abs(a.y - r.y) < 3)) {
        candidates.push({ ...base, accepted: false, reason: "doublon", score: 3 });
        continue;
      }
      const reason = `employé GOLD CDD (NOM PRENOM majuscules + ${goldFullUpper[2]}h${goldFullUpper[3] ?? ""})`;
      accepted.push({ name: displayName, y: r.y, x, score: 3 });
      candidates.push({ ...base, accepted: true, reason, score: 3 });
      continue;
    }

    if (text.length < 3) {
      candidates.push({ ...base, accepted: false, reason: "trop court", score: 0 });
      continue;
    }
    if (IGNORED.test(text) || DAY_HEADER_RE.test(text)) {
      candidates.push({ ...base, accepted: false, reason: "en-tête / métadonnée", score: 0 });
      continue;
    }
    if (TIME_RANGE_RE.test(text)) {
      candidates.push({ ...base, accepted: false, reason: "contient un créneau horaire", score: 0 });
      continue;
    }
    if (ACTIVITY_KEYWORDS.test(text) && !FIRSTNAME_FJ_RE.test(text)) {
      const kw = text.match(ACTIVITY_KEYWORDS)?.[0];
      candidates.push({ ...base, accepted: false, reason: `mot-clé d'activité « ${kw} »`, score: 0 });
      continue;
    }

    // Règle : 1 ou 2 mots tout en MAJUSCULES suivis de "FJ" → employé détecté.
    const surnameFj = text.match(/^([A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\-]+(?:\s+[A-ZÀ-ÝŒ][A-ZÀ-ÝŒ'\-]+)?)\s+FJ\b/);
    if (surnameFj) {
      const displayName = surnameFj[1].replace(/\s+/g, " ").trim();
      if (accepted.some((a) => a.name === displayName && Math.abs(a.y - r.y) < 3)) {
        candidates.push({ ...base, accepted: false, reason: "doublon", score: 2 });
        continue;
      }
      accepted.push({ name: displayName, y: r.y, x, score: 2 });
      candidates.push({ ...base, accepted: true, reason: "employé (NOM majuscules + FJ)", score: 2 });
      continue;
    }

    const weekly = text.match(WEEKLY_HOURS_RE);
    const nameOnly = text.replace(WEEKLY_HOURS_RE, " ").replace(/[^A-Za-zÀ-ÿŒœ'\- ]/g, " ");
    const letterTokens = nameOnly.split(/\s+/).filter((t) => t.length >= 2 && /[A-Za-zÀ-ÿŒœ]/.test(t));
    const upperTokens = letterTokens.filter((t) => t === t.toUpperCase() && /[A-ZÀ-ÝŒ]/.test(t));
    const properTokens = letterTokens.filter((t) => /^[A-ZÀ-ÝŒ][a-zà-ÿœ'\-]+$/.test(t));

    if (letterTokens.length < 2) {
      candidates.push({ ...base, accepted: false, reason: `pas assez de mots (${letterTokens.length})`, score: 0 });
      continue;
    }
    if (upperTokens.length < 1) {
      candidates.push({ ...base, accepted: false, reason: "aucun mot en MAJUSCULES (nom de famille)", score: 0 });
      continue;
    }

    let score = 1;
    if (upperTokens.length >= 1 && properTokens.length >= 1) score = 2;
    if (score >= 2 && weekly) score = 3;

    const displayName = letterTokens.join(" ");
    if (accepted.some((a) => a.name === displayName && Math.abs(a.y - r.y) < 3)) {
      candidates.push({ ...base, accepted: false, reason: "doublon", score });
      continue;
    }
    const reason =
      score === 3
        ? `employé (NOM + Prénom + ${weekly![1]}h${weekly![2]})`
        : score === 2
          ? "employé (NOM + Prénom)"
          : "employé (faible confiance)";
    accepted.push({ name: displayName, y: r.y, x, score });
    candidates.push({ ...base, accepted: true, reason, score });
  }

  // Filtre final : exclure les candidats avec score < 2 (faible confiance).
  const filteredAccepted = accepted.filter((a) => a.score >= 2);

  const filteredCandidates = candidates.filter((c) => c.score >= 2);

  filteredAccepted.sort((a, b) => b.y - a.y);

  const leftItems = items.filter(
    (it) => it.x < firstColX - 2 && it.y < headerY - 1 && it.y > 0
  );

  const leftYs: number[] = [];

  for (const it of leftItems.sort((a, b) => b.y - a.y)) {
    const last = leftYs[leftYs.length - 1];
    if (last !== undefined && Math.abs(last - it.y) <= 2) continue;
    leftYs.push(it.y);
  }

  const leftGapMids: number[] = [];

  for (let i = 0; i < leftYs.length - 1; i++) {
    const gap = leftYs[i] - leftYs[i + 1];
    if (gap > 15) leftGapMids.push((leftYs[i] + leftYs[i + 1]) / 2);
  }

  leftGapMids.sort((a, b) => b - a);

  gridLines.sort((a, b) => b - a);

  const contentAllCols = items.filter(
    (it) => it.x >= firstColX - 3 && it.y < headerY - 1 && it.y > 0
  );

  const refinedLeftGapMids = leftGapMids.map((mid) => {
    const glAbove = gridLines.find((g) => g > mid) ?? mid + 40;
    const glBelow = [...gridLines].reverse().find((g) => g < mid) ?? mid - 40;

    const windowYs = contentAllCols
      .filter((it) => it.y < glAbove && it.y > glBelow)
      .map((it) => it.y)
      .sort((a, b) => b - a);

    if (windowYs.length < 2) return mid;

    let bestGap = 0, bestMid = mid;
    for (let i = 0; i < windowYs.length - 1; i++) {
      const gap = windowYs[i] - windowYs[i + 1];
      if (gap > bestGap) { bestGap = gap; bestMid = (windowYs[i] + windowYs[i + 1]) / 2; }
    }

    return bestGap > 3 ? bestMid : mid;
  });

  const allBoundaries = [...new Set([...gridLines, ...refinedLeftGapMids])].sort((a, b) => b - a);

  const secondHeaderY = secondHeaderYParam;

  const bands: EmployeeBand[] = filteredAccepted.map((a, idx) => {
    const nextY = filteredAccepted[idx + 1]?.y ?? null;
    const prevY = filteredAccepted[idx - 1]?.y ?? null;

    let yTop: number;
    if (prevY === null) {
      yTop = (secondHeaderY as number | null) ?? headerY;
    } else {
      const above = allBoundaries.filter((g) => g > a.y);
      yTop = above.length > 0 ? above[above.length - 1] : (a.y + prevY) / 2;
    }

    let yBottom: number;
    if (nextY === null) {
      yBottom = -Infinity;
    } else {
      const aboveNext = allBoundaries.filter((g) => g > nextY).sort((a, b) => a - b);
      yBottom = aboveNext.length > 0 ? aboveNext[0] : (a.y + nextY) / 2;
    }

    return { name: a.name, yTop, yBottom, x: a.x };
  });

  const primary = filteredAccepted.slice().sort((a, b) => b.score - a.score)[0]?.name ?? null;

  return { bands, candidates: filteredCandidates, rowBands, primary };
}

function detectAllEmployees(items: Item[], headerY: number, firstColX: number): EmployeeBand[] {
  return detectEmployeesWithReasons(items, headerY, firstColX).bands;
}

function matchUserBand(bands: EmployeeBand[], fullName: string): EmployeeBand | null {
  const norm = normalize(fullName);
  const parts = norm.split(/\s+/).filter((p) => p.length >= 2);
  if (!parts.length) return null;
  return (
    bands.find((b) => {
      const n = normalize(b.name);
      return parts.every((p) => n.includes(p));
    }) ?? null
  );
}

function groupByY(items: Item[], tol = 2): Item[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const out: Item[][] = [];
  for (const it of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= tol) last.push(it);
    else out.push([it]);
  }
  return out;
}

function cellText(items: Item[], band: EmployeeBand, col: DayCol): string {
  const pageFooterRe = /^Page\s*\d+\s*\/\s*\d+$/i;

  const cellItems = items.filter(
    (it) =>
      it.y < band.yTop &&
      it.y >= band.yBottom &&
      it.x >= col.x - 3 &&
      it.x < col.xEnd - 3,
  );

  if (!cellItems.length) return "";

  const lines = groupByY(cellItems).map((line) =>
    line.sort((a, b) => a.x - b.x).map((i) => i.str).join(" "),
  ).filter((line) => !pageFooterRe.test(line.trim()));

  return lines.join(" \n ");
}

function parseCell(text: string, date: string): ParsedShift[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const TIME_RE = /(\d{1,2})\s*[h:H]\s*(\d{2})\s*[-–]\s*(\d{1,2})\s*[h:H]\s*(\d{2})/g;
  const matches = [...trimmed.matchAll(TIME_RE)];

  if (!matches.length) {
    const clean = trimmed.replace(/\s+/g, " ");
    if (clean.length < 2 || IGNORED.test(clean)) return [];
    return [
      {
        shift_date: date,
        start_time: null,
        end_time: null,
        activity: clean,
        notes: null,
        confidence: "medium",
        raw_line: clean,
      },
    ];
  }

  const shifts: ParsedShift[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : trimmed.length;
    const activity = trimmed.slice(start, end).replace(/\s+/g, " ").trim();
    shifts.push({
      shift_date: date,
      start_time: fmtTime(m[1], m[2]),
      end_time: fmtTime(m[3], m[4]),
      activity: activity || null,
      notes: null,
      confidence: "high",
      raw_line: trimmed,
    });
  }
  return shifts;
}

async function loadPlanningPages(supabase: any, planning_id: string, userId: string) {
  const { data: planning, error } = await supabase
    .from("plannings")
    .select("id, user_id, file_path")
    .eq("id", planning_id)
    .eq("user_id", userId)
    .single();
  if (error || !planning) throw new Error("Planning introuvable.");

  const { data: file, error: dlErr } = await supabase.storage
    .from("planning-pdfs")
    .download(planning.file_path);
  if (dlErr || !file) throw new Error(`Téléchargement PDF impossible: ${dlErr?.message ?? "fichier vide"}`);

  const buffer = new Uint8Array(await file.arrayBuffer());
  return loadPageItems(buffer);
}

async function loadUserName(supabase: any, userId: string): Promise<string> {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name, first_name, last_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const fullName =
    profile?.full_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  if (!fullName) throw new Error("Renseignez d'abord votre nom complet dans votre profil.");
  return fullName;
}

function normalizeTime(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return fmtTime(m[1], m[2]);
}

export const extractShiftsForPlanning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planning_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: planning, error } = await supabase
      .from("plannings")
      .select("id, user_id, ai_raw_json")
      .eq("id", data.planning_id)
      .eq("user_id", userId)
      .single();
    if (error || !planning) throw new Error("Planning introuvable.");

    const raw = planning.ai_raw_json as any;
    const result = raw?.result ?? raw;
    const events: any[] = Array.isArray(result?.events) ? result.events : [];

    const out: ParsedShift[] = events
      .filter((e) => e && typeof e === "object")
      .map((e) => {
        const conf =
          e.confidence === "high" || e.confidence === "medium" || e.confidence === "low"
            ? (e.confidence as "high" | "medium" | "low")
            : "high";
        return {
          shift_date: typeof e.date === "string" ? e.date : null,
          start_time: normalizeTime(e.start_time),
          end_time: normalizeTime(e.end_time),
          activity: typeof e.activity === "string" ? e.activity : null,
          notes: null,
          confidence: conf,
          raw_line: typeof e.raw_text === "string" ? e.raw_text : null,
        };
      });

    // Pipeline rédaction V1 brut : "events" est vide par construction.
    // On reconstruit les shifts personnels à partir de raw_grid.cells,
    // en filtrant sur le salarié correspondant à l'utilisateur connecté.
    if (result?.pipeline === "redaction") {
      const cells: any[] = Array.isArray(result?.raw_grid?.cells) ? result.raw_grid.cells : [];
      if (cells.length) {
        const fullName = await loadUserName(supabase, userId);
        const normalize = (s: string) =>
          (s ?? "")
            .toString()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .split(/[\s,]+/)
            .filter(Boolean)
            .sort()
            .join(" ");
        const target = normalize(fullName);
        for (const c of cells) {
          if (!c || c.empty) continue;
          if (normalize(c.employee) !== target) continue;
          const txt = typeof c.raw_text === "string" ? c.raw_text.trim() : "";
          if (!txt) continue;
          out.push({
            shift_date: typeof c.date === "string" ? c.date : null,
            start_time: null,
            end_time: null,
            activity: txt,
            notes: null,
            confidence: "high",
            raw_line: txt,
          });
        }
      }
    }

    out.sort((a, b) => {
      if ((a.shift_date ?? "") !== (b.shift_date ?? ""))
        return (a.shift_date ?? "").localeCompare(b.shift_date ?? "");
      return (a.start_time ?? "").localeCompare(b.start_time ?? "");
    });

    await supabase.from("shifts").delete().eq("planning_id", data.planning_id).eq("user_id", userId);
    if (out.length) {
      const rows = out.map((s) => ({ ...s, planning_id: data.planning_id, user_id: userId }));
      const { error: insErr } = await supabase.from("shifts").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }

    return { count: out.length };
  });

export const diagnosePlanning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ planning_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ fullName: string; pages: DiagnosticPage[] }> => {
    const { supabase, userId } = context;
    const fullName = await loadUserName(supabase, userId);
    const pages = await loadPlanningPages(supabase, data.planning_id, userId);
    const allText = pages.flatMap((p) => p.map((i) => i.str)).join(" ");
    const weekStart = parseWeekStart(allText);

    const out: DiagnosticPage[] = [];
    pages.forEach((items, idx) => {
      const pageWidth = items.reduce((m, i) => Math.max(m, i.x), 0);
      const pageHeight = items.reduce((m, i) => Math.max(m, i.y), 0);
      const allItems = items.map((i) => ({ str: i.str, x: i.x, y: i.y }));

      const cols = detectDayColumns(items, weekStart);
      const headerY = cols ? Math.max(...cols.map((c) => c.headerY)) : null;
      const firstColX = cols ? Math.min(...cols.map((c) => c.x)) : null;

      let bands: EmployeeBand[] = [];
      let leftCandidates: LeftCandidate[] = [];
      let rowBands: RowBand[] = [];
      let primary: string | null = null;
      if (cols && headerY !== null && firstColX !== null) {
        const r = detectEmployeesWithReasons(items, headerY, firstColX);
        bands = r.bands;
        leftCandidates = r.candidates;
        rowBands = r.rowBands;
        primary = r.primary;
      }

      const userBand = matchUserBand(bands, fullName);
      // Profile match wins over score-based primary.
      if (userBand) primary = userBand.name;
      const cells: DiagnosticCell[] = [];
      if (cols && userBand) {
        for (const col of cols) {
          const text = cellText(items, userBand, col);
          if (!text) continue;
          cells.push({
            employee: userBand.name,
            date: col.date ? fmtDateISO(col.date) : null,
            dayIndex: col.dayIndex,
            x: col.x,
            xEnd: col.xEnd === Infinity ? -1 : col.xEnd,
            yTop: userBand.yTop,
            yBottom: userBand.yBottom === -Infinity ? -1 : userBand.yBottom,
            text,
          });
        }
      }

      out.push({
        page: idx + 1,
        weekStart: weekStart ? fmtDateISO(weekStart) : null,
        pageWidth,
        pageHeight,
        headerY,
        firstColX,
        totalItems: items.length,
        allItems,
        rowBands,
        leftCandidates,
        primaryEmployee: primary,
        dayColumns: (cols ?? []).map((c) => ({
          date: c.date ? fmtDateISO(c.date) : null,
          dayIndex: c.dayIndex,
          x: c.x,
          xEnd: c.xEnd === Infinity ? -1 : c.xEnd,
        })),
        employees: bands.map((b) => ({
          name: b.name,
          yTop: b.yTop,
          yBottom: b.yBottom === -Infinity ? -1 : b.yBottom,
          x: b.x,
          isUser: !!userBand && b.name === userBand.name,
        })),
        cells,
        matchedUser: userBand?.name ?? null,
      });
    });

    return { fullName, pages: out };
  });

export type RawGridCell = {
  employee: string;
  date: string | null;
  day_index: number;
  raw_text: string;
  empty: boolean;
};

function mergeFragmentedItems(items: { str: string; x: number; y: number }[]): { str: string; x: number; y: number }[] {
  const byY = groupByY(items, 2);
  const result: { str: string; x: number; y: number }[] = [];
  for (const line of byY) {
    const sorted = line.slice().sort((a, b) => a.x - b.x);
    const merged: { str: string; x: number; y: number }[] = [];
    let current = { ...sorted[0] };
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      if (next.x - current.x < 10 && current.str.length <= 2) {
        current = { ...current, str: current.str + next.str };
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);
    result.push(...merged);
  }
  return result;
}

export async function buildRawGridFromPdf(
  items: Item[],
  weekStart: Date | null,
  gridLines?: number[],
): Promise<RawGridCell[]> {
  items = mergeFragmentedItems(items);
  const cols = detectDayColumns(items, weekStart);
  if (!cols || cols.length === 0) return [];
  const headerY = Math.max(...cols.map((c) => c.headerY));
  const firstColX = cols[0].x;
  const secondHeaderY = (cols[0] as any).secondHeaderY ?? null;
  const lines = gridLines ?? [];

  const { bands } = detectEmployeesWithReasons(
    items, headerY, firstColX, secondHeaderY, lines
  );

  const result: RawGridCell[] = [];
  for (const band of bands) {
    for (const col of cols) {
      const raw_text = cellText(items, band, col);
      const iso = col.date
        ? `${col.date.getUTCFullYear()}-${String(col.date.getUTCMonth() + 1).padStart(2, "0")}-${String(col.date.getUTCDate()).padStart(2, "0")}`
        : null;
      result.push({
        employee: band.name,
        date: iso,
        day_index: col.dayIndex,
        raw_text,
        empty: raw_text.trim().length === 0,
      });
    }
  }
  return result;
}

export type ServiceEvent = {
  employee: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  activity: string | null;
  raw_text: string;
  event_type: "shift" | "absence";
  confidence: "high" | "medium" | "low";
};

// Combine raw_grid.cells (texte brut par cellule) avec parseCell (qui extrait
// les horaires structurés) pour produire le format service_events attendu
// par ServicePlanningView. Utilisé uniquement par le pipeline OPS déterministe
// (jamais par le pipeline rédaction, qui reste volontairement en raw_grid brut).
function formatHHMM(t: string | null): string | null {
  if (!t) return null;
  return t.slice(0, 5).replace(":", "h");
}

export function buildServiceEventsFromCells(cells: RawGridCell[]): ServiceEvent[] {
  const out: ServiceEvent[] = [];

  for (const cell of cells) {
    if (cell.empty || !cell.date) continue;

    const shifts = parseCell(cell.raw_text, cell.date);
    const multi = shifts.length > 1;

    for (const s of shifts) {
      // raw_text est affiché tel quel par ServicePlanningView (cellText() le
      // priorise sur activity). Si une cellule contient plusieurs shifts, on
      // NE PEUT PAS réutiliser le raw_text complet de la cellule pour chacun
      // (sinon le même bloc s'affiche en double/triple) — on reconstruit donc
      // un texte propre par shift (horaire + activité).

      let perShiftRawText: string;

      if (!multi) {
        perShiftRawText = cell.raw_text;
      } else if (s.start_time && s.end_time) {
        perShiftRawText = `${formatHHMM(s.start_time)}-${formatHHMM(s.end_time)}${s.activity ? " " + s.activity : ""}`;
      } else {
        perShiftRawText = s.activity ?? "";
      }

      out.push({
        employee: cell.employee,
        date: s.shift_date,
        start_time: s.start_time,
        end_time: s.end_time,
        all_day: !s.start_time,
        activity: s.activity,
        raw_text: perShiftRawText,
        event_type: s.start_time ? "shift" : "absence",
        confidence: s.confidence,
      });
    }
  }

  return out;
}
