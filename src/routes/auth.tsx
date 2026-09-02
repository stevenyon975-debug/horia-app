import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import horiaLogo from "@/assets/horia-logo.png.asset.json";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Connexion — HorIA" }] }),
  component: AuthPage,
});

/**
 * Connexion par code à 6 chiffres.
 *
 * On n'utilise volontairement PAS de lien magique cliquable : les scanners
 * anti-spam (Gmail, antivirus de messagerie d'entreprise) visitent
 * automatiquement les liens des e-mails reçus. Comme un lien magique est à
 * usage unique, le scanner consomme le jeton avant l'utilisateur, qui se
 * retrouve avec « Email link is invalid or has expired ». Un code saisi à la
 * main n'est pas cliquable, donc immunisé.
 */
function AuthPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"email" | "code">("email");
  const [resendIn, setResendIn] = useState(0);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session) navigate({ to: "/planning", replace: true });
  }, [session, navigate]);

  // Compte à rebours avant de pouvoir redemander un code
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      setStep("code");
      setCode("");
      setResendIn(60);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'envoi");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "email",
      });
      if (error) throw error;
      // La redirection est prise en charge par le useEffect sur `session`.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Code invalide";
      toast.error(
        /invalid|expired/i.test(msg)
          ? "Code invalide ou expiré. Demandez-en un nouveau."
          : msg,
      );
      setCode("");
      codeInputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-border bg-background/50 px-3 py-2.5 text-sm outline-none focus:border-primary";
  const buttonStyle = { background: "var(--gradient-primary)" };
  const buttonClass =
    "w-full rounded-lg px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60";

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
            {step === "email"
              ? "Accédez à votre espace HorIA"
              : "Saisissez le code reçu par e-mail"}
          </p>

          {step === "email" ? (
            <form onSubmit={sendCode} className="mt-6 space-y-3">
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="Votre adresse email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
              <button type="submit" disabled={loading} className={buttonClass} style={buttonStyle}>
                {loading ? "Envoi…" : "Recevoir mon code"}
              </button>
              <p className="text-center text-xs text-muted-foreground">
                Pas encore de compte ? Il sera créé automatiquement.
              </p>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="mt-6 space-y-3">
              <p className="text-sm text-muted-foreground">
                Un code a été envoyé à <strong>{email}</strong>. Utilisez celui
                du dernier e-mail reçu, et pensez à vérifier vos spams.
              </p>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                // La longueur du code est un réglage Supabase (MAILER_OTP_LENGTH),
                // pas une constante : ici il fait 8 chiffres. On accepte donc une
                // plage plutôt qu'une longueur figée, sinon le champ tronque le
                // code et la vérification échoue systématiquement.
                pattern="[0-9]{6,10}"
                maxLength={10}
                required
                placeholder="Code reçu par e-mail"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className={`${inputClass} text-center font-mono text-2xl tracking-[0.3em]`}
              />
              <button
                type="submit"
                disabled={loading || code.length < 6}
                className={buttonClass}
                style={buttonStyle}
              >
                {loading ? "Vérification…" : "Se connecter"}
              </button>

              <div className="flex items-center justify-between pt-1 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                  }}
                  className="text-muted-foreground hover:underline"
                >
                  Changer d'adresse
                </button>
                <button
                  type="button"
                  disabled={resendIn > 0 || loading}
                  onClick={() => sendCode()}
                  className="text-primary-glow hover:underline disabled:text-muted-foreground disabled:no-underline"
                >
                  {resendIn > 0 ? `Renvoyer un code (${resendIn}s)` : "Renvoyer un code"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
