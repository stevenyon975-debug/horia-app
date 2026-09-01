import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Loader2, Save, Calendar, CheckCircle2, Unlink } from "lucide-react";
import {
  connectGoogle,
  createTestEvent,
  disconnectGoogle,
  getGoogleConnection,
  type GoogleConnection,
} from "@/lib/google-calendar";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profil — HorIA" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user } = useAuth();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [gcalLoading, setGcalLoading] = useState(true);
  const [gcalConnecting, setGcalConnecting] = useState(false);
  const [gcalDisconnecting, setGcalDisconnecting] = useState(false);
  const [gcal, setGcal] = useState<GoogleConnection | null>(null);
  const [creatingEvent, setCreatingEvent] = useState(false);

  const handleCreateTestEvent = async () => {
    setCreatingEvent(true);
    try {
      const ev = await createTestEvent();
      toast.success(
        ev.htmlLink
          ? `Événement "TEST HorIA" créé. Voir : ${ev.htmlLink}`
          : `Événement "TEST HorIA" créé (id ${ev.id}).`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Profile] createTestEvent failed", e);
      toast.error(`Création événement échouée : ${msg}`);
    } finally {
      setCreatingEvent(false);
    }
  };

  const loadStatus = useCallback(async () => {
    setGcalLoading(true);
    try {
      setGcal(await getGoogleConnection());
    } finally {
      setGcalLoading(false);
    }
  }, []);

  // Load profile + connection status
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, first_name, last_name")
        .eq("id", user.id)
        .maybeSingle();
      if (error) toast.error(error.message);
      setFullName(
        data?.full_name ??
          [data?.first_name, data?.last_name].filter(Boolean).join(" "),
      );
      setLoading(false);
    })();
    loadStatus();
  }, [user, loadStatus]);

  // After OAuth redirect back from /api/public/google/callback, refresh status
  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location.href);
    const connected = url.searchParams.get("google_connected");
    const oauthErr = url.searchParams.get("google_error");
    if (!connected && !oauthErr) return;

    (async () => {
      setGcalConnecting(true);
      try {
        if (oauthErr) {
          console.error("[Profile] OAuth callback error", oauthErr);
          toast.error(`Connexion Google échouée : ${oauthErr}`);
        } else {
          const row = await getGoogleConnection();
          setGcal(row);
          if (row) toast.success("Google Agenda connecté");
          else toast.error("Connexion Google : aucune ligne trouvée.");
        }
      } finally {
        setGcalConnecting(false);
        url.searchParams.delete("google_connected");
        url.searchParams.delete("google_error");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    })();
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ full_name: fullName.trim() })
      .eq("id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profil enregistré");
  };

  const handleConnect = async () => {
    setGcalConnecting(true);
    try {
      await connectGoogle();
      // Browser is navigating to Google; nothing more to do here.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[Profile] connectGoogle failed", e);
      toast.error(`Connexion Google impossible : ${msg}`);
      setGcalConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setGcalDisconnecting(true);
    try {
      await disconnectGoogle();
      setGcal(null);
      toast.success("Google Agenda déconnecté");
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    } finally {
      setGcalDisconnecting(false);
    }
  };

  return (
    <AppShell title="Profil">
      <p className="-mt-6 text-muted-foreground">
        Votre nom complet doit correspondre exactement à celui inscrit sur vos plannings.
      </p>

      <div
        className="mt-8 max-w-xl rounded-2xl border border-border/60 p-6"
        style={{ background: "var(--gradient-surface)" }}
      >
        {loading ? (
          <div className="flex items-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Adresse e-mail</label>
              <input
                value={user?.email ?? ""}
                disabled
                className="w-full rounded-lg border border-border bg-background/40 px-3 py-2 text-sm text-muted-foreground"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Nom complet</label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="ex. Fabien Martin"
                className="w-full rounded-lg border border-border bg-background/40 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Utilisé pour détecter vos shifts dans les plannings PDF.
              </p>
            </div>
            <button
              onClick={save}
              disabled={saving || !fullName.trim()}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              style={{ background: "var(--gradient-primary)" }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </button>
          </div>
        )}
      </div>

      <div
        className="mt-6 max-w-xl rounded-2xl border border-border/60 p-6"
        style={{ background: "var(--gradient-surface)" }}
      >
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10">
            <Calendar className="h-5 w-5 text-primary-glow" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold">Google Agenda</h2>
              {!gcalLoading && gcal && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-500">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Connecté
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Reliez votre compte Google pour préparer la synchronisation de vos shifts vers Google Agenda.
            </p>
          </div>
        </div>

        <div className="mt-5">
          {gcalLoading ? (
            <div className="flex items-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Vérification…
            </div>
          ) : gcal ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Compte&nbsp;: </span>
                <span className="font-medium break-all">{gcal.email ?? "—"}</span>
              </div>
              <button
                onClick={handleCreateTestEvent}
                disabled={creatingEvent}
                className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 sm:w-auto"
                style={{ background: "var(--gradient-primary)" }}
              >
                {creatingEvent ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Calendar className="h-4 w-4" />
                )}
                Créer un événement test
              </button>
              <button
                onClick={handleDisconnect}
                disabled={gcalDisconnecting}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background/40 px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60 sm:w-auto"
              >
                {gcalDisconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Unlink className="h-4 w-4" />
                )}
                Déconnecter Google Agenda
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">Non connecté</div>
              <button
                onClick={handleConnect}
                disabled={gcalConnecting}
                className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 sm:w-auto"
                style={{ background: "var(--gradient-primary)" }}
              >
                {gcalConnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Calendar className="h-4 w-4" />
                )}
                Connecter Google Agenda
              </button>
              <p className="text-xs text-muted-foreground">
                Permissions demandées : accès à votre adresse Google et création d'événements (calendar.events).
              </p>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
