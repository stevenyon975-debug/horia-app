import { supabase } from "@/integrations/supabase/client";
import {
  startGoogleCalendarOAuth,
  createGoogleTestEvent,
  disconnectGoogleCalendar,
} from "@/lib/google-oauth.functions";

export type GoogleConnection = {
  id: string;
  user_id: string;
  email: string | null;
  provider: string;
  connected_at: string;
  status: string | null;
};

/** Returns true if the current user has a recorded Google connection. */
export async function isGoogleConnected(): Promise<boolean> {
  const conn = await getGoogleConnection();
  return !!conn && conn.status !== "disconnected";
}

/** Returns the current user's Google connection row (no tokens), or null. */
export async function getGoogleConnection(): Promise<GoogleConnection | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("google_connections")
    .select("id, user_id, email, provider, connected_at, status")
    .eq("user_id", user.id)
    .eq("provider", "google")
    .maybeSingle();
  if (error) {
    console.error("[getGoogleConnection]", error);
    return null;
  }
  return (data as GoogleConnection | null);
}

/** Start the standalone Google Calendar OAuth flow (redirects the browser to Google). */
export async function connectGoogle(): Promise<void> {
  const { authUrl } = await startGoogleCalendarOAuth();
  window.location.href = authUrl;
}

/** Create a 30-min test event tomorrow in the connected Google Calendar (server-side). */
export async function createTestEvent(): Promise<{ htmlLink: string | null; id: string }> {
  return await createGoogleTestEvent();
}

/** Removes the recorded Google connection row (and server-side tokens). */
export async function disconnectGoogle(): Promise<void> {
  await disconnectGoogleCalendar();
}
