import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");
        const origin = `${url.protocol}//${url.host}`;

        const redirectError = (msg: string) => {
          console.error("[google/callback]", msg);
          const u = new URL("/profile", origin);
          u.searchParams.set("google_error", msg);
          return Response.redirect(u.toString(), 302);
        };

        if (errorParam) return redirectError(errorParam);
        if (!code || !state) return redirectError("missing_code_or_state");

        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          return redirectError("server_oauth_credentials_missing");
        }

        const { supabaseAdmin } = await import(
          "@/integrations/supabase/client.server"
        );

        // 1. Validate state + recover user_id
        const { data: stateRow, error: stateErr } = await supabaseAdmin
          .from("google_oauth_states")
          .select("user_id, redirect_uri")
          .eq("state", state)
          .maybeSingle();
        if (stateErr || !stateRow) {
          return redirectError("invalid_or_expired_state");
        }

        // Consume the state immediately
        await supabaseAdmin
          .from("google_oauth_states")
          .delete()
          .eq("state", state);

        // 2. Exchange code → tokens
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: stateRow.redirect_uri,
          }),
        });
        if (!tokenRes.ok) {
          const txt = await tokenRes.text();
          return redirectError(`token_exchange_failed_${tokenRes.status}_${txt.slice(0, 120)}`);
        }
        const tokens = (await tokenRes.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in: number;
          scope?: string;
          id_token?: string;
        };

        // 3. Fetch the Google user email
        let googleEmail: string | null = null;
        try {
          const uRes = await fetch(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            { headers: { Authorization: `Bearer ${tokens.access_token}` } },
          );
          if (uRes.ok) {
            const u = (await uRes.json()) as { email?: string };
            googleEmail = u.email ?? null;
          }
        } catch (e) {
          console.error("[google/callback] userinfo failed", e);
        }

        const expiresAt = new Date(
          Date.now() + tokens.expires_in * 1000,
        ).toISOString();

        // 4. Persist (upsert) — keep existing refresh_token if Google omitted it
        const update = {
          user_id: stateRow.user_id,
          provider: "google",
          email: googleEmail,
          access_token: tokens.access_token,
          expires_at: expiresAt,
          scope: tokens.scope ?? null,
          status: "connected",
          connected_at: new Date().toISOString(),
          ...(tokens.refresh_token
            ? { refresh_token: tokens.refresh_token }
            : {}),
        };

        const { error: upErr } = await supabaseAdmin
          .from("google_connections")
          .upsert(update, { onConflict: "user_id,provider" });
        if (upErr) {
          return redirectError(`persist_failed_${upErr.message}`);
        }

        // 5. Redirect back to /profile
        const successUrl = new URL("/profile", origin);
        successUrl.searchParams.set("google_connected", "1");
        return Response.redirect(successUrl.toString(), 302);
      },
    },
  },
});
