import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  Users,
  Building2,
  CalendarCheck,
  ArrowRight,
  Check,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import horiaLogo from "@/assets/horia-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "HorIA — L'assistant IA des salariés" },
      { name: "description", content: "Planning, fiches de paie, documents et e-mails : HorIA simplifie votre vie professionnelle." },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: CalendarDays, title: "Mon planning", desc: "Importez votre PDF et consultez votre planning personnel avec le cumul d'heures hebdomadaire." },
  { icon: Users, title: "Planning du service", desc: "Accédez au tableau complet de votre service et de vos collègues en un coup d'œil." },
  { icon: Building2, title: "Autres services", desc: "Consultez les plannings des autres services de France Télévisions SPM." },
  { icon: CalendarCheck, title: "Synchronisation calendrier", desc: "Synchronisez vos shifts personnels avec Google Calendar ou Apple Calendar." },
];

function Landing() {
  const { session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (session) navigate({ to: "/planning", replace: true });
  }, [session, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2">
            <img src={horiaLogo.url} alt="HorIA" className="h-9 w-9 rounded-lg" />
            <span className="font-display text-lg font-semibold tracking-tight">HorIA</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link to="/auth" className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:text-foreground">
              Connexion
            </Link>
            <Link
              to="/auth"
              className="rounded-md px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
              style={{ background: "var(--gradient-primary)" }}
            >
              Commencer
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10" style={{ background: "var(--gradient-hero)" }} />
        <div className="mx-auto max-w-4xl px-6 py-24 text-center sm:py-32">
          <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-7xl">
            Votre planning,{" "}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-primary)" }}>
              simplifié
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
            HorIA vous permet de consulter et gérer vos plannings hebdomadaires en un coup d'œil. Accédez à votre planning personnel et à celui de vos collègues, où que vous soyez.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/auth"
              className="group inline-flex items-center gap-2 rounded-lg px-6 py-3 text-sm font-medium text-primary-foreground transition-all hover:scale-[1.02]"
              style={{ background: "var(--gradient-primary)", boxShadow: "var(--shadow-glow)" }}
            >
              Essayer gratuitement
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </section>



      <footer className="border-t border-border/50 py-10 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} HorIA — Conçu pour les salariés.
      </footer>
    </div>
  );
}
