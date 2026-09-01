import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import horiaLogo from "@/assets/horia-logo.png.asset.json";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Connexion — HorIA" }] }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (session) navigate({ to: "/planning", replace: true });
  }, [session, navigate]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/planning`,
        },
      });
      if (error) throw error;
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: "var(--gradient-hero), var(--background)" }}
    >
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <img src={horiaLogo.url} alt="HorIA" className="h-10 w-10 rounded-lg" />
          <span className="font-display text-xl font-semibold">HorIA</span>
        </Link>

        <div
          className="rounded-2xl border border-border/60 p-8"
          style={{ background: "var(--gradient-surface)", boxShadow: "var(--shadow-soft)" }}
        >
          <h1 className="font-display text-2xl font-bold">Connexion</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Accédez à votre espace HorIA
          </p>

          {sent ? (
            <div className="mt-6 rounded-lg border border-border bg-background/50 p-4 text-sm">
              <p className="font-medium text-foreground">Lien envoyé ✓</p>
              <p className="mt-1 text-muted-foreground">
                Vérifiez votre boîte mail <strong>{email}</strong> et cliquez sur le lien
                pour vous connecter. (Vérifiez aussi vos spams.)
              </p>
              <button
                type="button"
                onClick={() => setSent(false)}
                className="mt-3 text-xs text-primary-glow hover:underline"
              >
                Utiliser une autre adresse
              </button>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="mt-6 space-y-3">
              <input
                type="email"
                required
                placeholder="Votre adresse email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-border bg-background/50 px-3 py-2.5 text-sm outline-none focus:border-primary"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                style={{ background: "var(--gradient-primary)" }}
              >
                {loading ? "Envoi…" : "Recevoir mon lien de connexion"}
              </button>
              <p className="text-center text-xs text-muted-foreground">
                Pas encore de compte ? Le lien en créera un automatiquement.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
