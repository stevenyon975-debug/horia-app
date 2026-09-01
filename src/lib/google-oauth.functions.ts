import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

function getOrigin(): string {
  const host = getRequestHeader("x-forwarded-host") || getRequestHeader("host");
  const proto = getRequestHeader("x-forwarded-proto") || "https";
  if (!host) throw new Error("Impossible de déterminer l'origine de la requête.");
  return `${proto}://${host}`;
}

function getRedirectUri(): string {
  return `${getOrigin()}/api/public/google/callback`;
}

/** Start the standalone Google Calendar OAuth flow. Returns the Google auth URL. */
export const startGoogleCalendarOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) throw new Error("GOOGLE_OAUTH_CLIENT_ID manquant côté serveur.");

    const redirectUri = getRedirectUri();
    const state = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Clean up old states for this user (>30 min)
    await supabaseAdmin
      .from("google_oauth_states")
      .delete()
      .lt("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

    const { error: insErr } = await supabaseAdmin
      .from("google_oauth_states")
      .insert({ state, user_id: userId, redirect_uri: redirectUri });
    if (insErr) throw new Error(`Impossible d'initialiser l'OAuth : ${insErr.message}`);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_SCOPES,
      access_type: "offline",
      prompt: "select_account consent",
      include_granted_scopes: "true",
      state,
    });

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    // ——— TEMPORARY DIAGNOSTIC LOGS ———
    const maskedClientId =
      clientId.slice(0, 8) + "..." + clientId.slice(-8);
    console.log("[diag:startGoogleCalendarOAuth] origin        =", getOrigin());
    console.log("[diag:startGoogleCalendarOAuth] redirect_uri  =", redirectUri);
    console.log("[diag:startGoogleCalendarOAuth] client_id     =", maskedClientId);
    console.log("[diag:startGoogleCalendarOAuth] scope         =", GOOGLE_SCOPES);
    console.log("[diag:startGoogleCalendarOAuth] access_type   =", "offline");
    console.log("[diag:startGoogleCalendarOAuth] prompt        =", "select_account consent");
    console.log("[diag:startGoogleCalendarOAuth] authUrl       =", authUrl);
    // ————————————————————————————————————

    return { authUrl };
  });

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

async function refreshIfNeeded(row: {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
}): Promise<{ accessToken: string; expiresAt: string | null }> {
  const now = Date.now();
  const expMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (row.access_token && expMs - 60_000 > now) {
    return { accessToken: row.access_token, expiresAt: row.expires_at };
  }
  if (!row.refresh_token) {
    throw new Error(
      "Jeton d'accès Google expiré et aucun refresh_token disponible. Reconnectez Google Agenda.",
    );
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Identifiants OAuth Google manquants côté serveur.");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Refresh Google token ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as TokenResponse;
  const newExpires = new Date(Date.now() + json.expires_in * 1000).toISOString();
  return { accessToken: json.access_token, expiresAt: newExpires };
}

/** Create a 30-min test event tomorrow at 10:00 in the connected Google Calendar. */
export const createGoogleTestEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("google_connections")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .eq("provider", "google")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Aucune connexion Google enregistrée. Connectez Google Agenda.");

    const { accessToken, expiresAt } = await refreshIfNeeded(
      row as { access_token: string | null; refresh_token: string | null; expires_at: string | null },
    );

    // Persist refreshed token if it changed
    if (accessToken !== row.access_token) {
      await supabaseAdmin
        .from("google_connections")
        .update({ access_token: accessToken, expires_at: expiresAt })
        .eq("user_id", userId)
        .eq("provider", "google");
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const end = new Date(tomorrow.getTime() + 30 * 60 * 1000);

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: "TEST HorIA",
          start: { dateTime: tomorrow.toISOString(), timeZone: "America/Miquelon" },
          end: { dateTime: end.toISOString(), timeZone: "America/Miquelon" },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`Google Calendar API ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as { id: string; htmlLink?: string };
    return { id: data.id, htmlLink: data.htmlLink ?? null };
  });

/** Disconnect: remove tokens server-side. */
export const disconnectGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("google_connections")
      .delete()
      .eq("user_id", userId)
      .eq("provider", "google");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Sync all shifts of a planning to Google Calendar (create events, no dedup). */
export const syncShiftsToGoogleCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ planning_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: conn, error: connErr } = await supabaseAdmin
      .from("google_connections")
      .select("access_token, refresh_token, expires_at")
      .eq("user_id", userId)
      .eq("provider", "google")
      .maybeSingle();
    if (connErr) throw new Error(connErr.message);
    if (!conn) throw new Error("Aucune connexion Google enregistrée. Connectez Google Agenda.");

    const { accessToken, expiresAt } = await refreshIfNeeded(
      conn as { access_token: string | null; refresh_token: string | null; expires_at: string | null },
    );
    if (accessToken !== conn.access_token) {
      await supabaseAdmin
        .from("google_connections")
        .update({ access_token: accessToken, expires_at: expiresAt })
        .eq("user_id", userId)
        .eq("provider", "google");
    }

    const { data: shifts, error: shErr } = await supabaseAdmin
      .from("shifts")
      .select("id, shift_date, start_time, end_time, activity, google_event_id")
      .eq("planning_id", data.planning_id)
      .eq("user_id", userId);
    if (shErr) throw new Error(shErr.message);
    if (!shifts || shifts.length === 0) {
      return { created: 0, alreadySynced: 0, failed: 0, errors: [] as string[], firstSample: null };
    }

    let created = 0;
    let alreadySynced = 0;
    let failed = 0;
    const errors: string[] = [];
    const TZ = "America/Miquelon";
    let firstSample: {
      horIA_date: string;
      horIA_start: string;
      horIA_end: string;
      googleStartDateTime: string;
      googleEndDateTime: string;
      timezone: string;
      payload: { summary: string; start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } };
    } | null = null;

    for (const s of shifts as Array<{
      id: string;
      shift_date: string | null;
      start_time: string | null;
      end_time: string | null;
      activity: string | null;
      google_event_id: string | null;
    }>) {
      if (s.google_event_id) {
        alreadySynced++;
        continue;
      }
      if (!s.shift_date || !s.start_time || !s.end_time || !s.activity) {
        failed++;
        errors.push(`Shift ${s.id} ignoré (champs manquants).`);
        continue;
      }
      const startDateTime = `${s.shift_date}T${s.start_time.slice(0, 8).padEnd(8, "0")}`;
      const endDateTime = `${s.shift_date}T${s.end_time.slice(0, 8).padEnd(8, "0")}`;

      const payload = {
        summary: s.activity,
        start: { dateTime: startDateTime, timeZone: TZ },
        end: { dateTime: endDateTime, timeZone: TZ },
      };

      if (!firstSample) {
        firstSample = {
          horIA_date: s.shift_date,
          horIA_start: s.start_time,
          horIA_end: s.end_time,
          googleStartDateTime: startDateTime,
          googleEndDateTime: endDateTime,
          timezone: TZ,
          payload,
        };
      }

      try {
        const res = await fetch(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        );
        if (!res.ok) {
          failed++;
          errors.push(`Shift ${s.shift_date} ${s.activity}: ${res.status} ${await res.text()}`);
        } else {
          const body = (await res.json()) as { id?: string };
          if (body.id) {
            const { error: updErr } = await supabaseAdmin
              .from("shifts")
              .update({ google_event_id: body.id })
              .eq("id", s.id);
            if (updErr) {
              errors.push(`Shift ${s.id} créé dans Google mais ID non sauvegardé: ${updErr.message}`);
            }
          }
          created++;
        }
      } catch (e: any) {
        failed++;
        errors.push(`Shift ${s.shift_date} ${s.activity}: ${e?.message ?? String(e)}`);
      }
    }

    return { created, alreadySynced, failed, errors, firstSample };
  });

/** Reset Google sync state for all shifts of a planning (clears google_event_id locally). */
export const resetGoogleSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ planning_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: updated, error } = await supabaseAdmin
      .from("shifts")
      .update({ google_event_id: null })
      .eq("planning_id", data.planning_id)
      .eq("user_id", userId)
      .not("google_event_id", "is", null)
      .select("id");

    if (error) throw new Error(error.message);
    return { resetCount: updated?.length ?? 0 };
  });
