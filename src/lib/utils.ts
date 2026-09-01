import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Supprime les préfixes numériques techniques du type 01_, 02_, etc. pour l'affichage uniquement. */
export function cleanActivityPrefix(activity: string | null): string {
  if (!activity) return "—";
  return activity.trim().replace(/^\d+_/, "");
}

/** Date du jour normalisée en UTC minuit (pour comparer avec des shift_date YYYY-MM-DD). */
export function getTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Début de semaine ISO (lundi) en UTC. */
export function weekStartUTC(d: Date): Date {
  const day = d.getUTCDay(); // 0..6 (Sun..Sat)
  const diff = (day + 6) % 7; // Mon=0
  const ws = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  ws.setUTCDate(ws.getUTCDate() - diff);
  return ws;
}

export type WeekBadge = "current" | "next" | "forecast" | "history" | null;

/** Renvoie le badge à afficher pour une semaine donnée (par rapport à aujourd'hui). */
export function getWeekBadge(weekStart: Date, today: Date = getTodayUTC()): WeekBadge {
  const currentWs = weekStartUTC(today);
  const diffDays = Math.round((weekStart.getTime() - currentWs.getTime()) / 86400000);
  if (diffDays === 0) return "current";
  if (diffDays === 7) return "next";
  if (diffDays > 7) return "forecast";
  if (diffDays < 0) return "history";
  return null;
}

/**
 * Comparator pour ordonner les semaines :
 *  1. Semaine en cours
 *  2. Semaine suivante immédiate
 *  3. Semaines futures (croissant)
 *  4. Historique (décroissant : plus récent en premier)
 */
export function compareWeeksForDisplay(a: Date, b: Date, today: Date = getTodayUTC()): number {
  const ws = weekStartUTC(today).getTime();
  const da = Math.round((a.getTime() - ws) / 86400000);
  const db = Math.round((b.getTime() - ws) / 86400000);
  const rank = (d: number) => (d === 0 ? 0 : d > 0 ? 1 : 2);
  const ra = rank(da);
  const rb = rank(db);
  if (ra !== rb) return ra - rb;
  if (ra === 1) return da - db; // futur croissant
  if (ra === 2) return db - da; // historique décroissant
  return 0;
}

