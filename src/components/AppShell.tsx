import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  CalendarDays,
  LogOut,
  User,
  type LucideIcon,
} from "lucide-react";
import horiaLogo from "@/assets/horia-logo.png.asset.json";
import { useAuth } from "@/hooks/use-auth";
import type { ReactNode } from "react";

const nav: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/planning", label: "Planning", icon: CalendarDays },
  { to: "/profile", label: "Profil", icon: User },
];

export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-2 px-5">
          <img src={horiaLogo.url} alt="HorIA" className="h-9 w-9 rounded-lg" />
          <span className="font-display text-lg font-semibold tracking-tight text-sidebar-foreground">HorIA</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="mb-2 px-3 py-2 text-xs text-sidebar-foreground/60 truncate">{user?.email}</div>
          <button
            onClick={async () => {
              await signOut();
              navigate({ to: "/" });
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          >
            <LogOut className="h-4 w-4" />
            Déconnexion
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {/* Mobile top nav */}
        <div className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:hidden">
          <Link to="/dashboard" className="flex items-center gap-2">
            <img src={horiaLogo.url} alt="HorIA" className="h-8 w-8 rounded-md" />
            <span className="font-display font-semibold">HorIA</span>
          </Link>
          <button onClick={() => signOut().then(() => navigate({ to: "/" }))} aria-label="Déconnexion">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {/* Mobile tab bar */}
        <div className="fixed bottom-0 left-0 right-0 z-40 flex justify-around border-t border-border bg-background/95 py-2 backdrop-blur md:hidden">
          {nav.map((item) => {
            const active = pathname === item.to;
            return (
              <Link key={item.to} to={item.to} className={`flex flex-col items-center gap-1 px-2 py-1 text-xs ${active ? "text-primary-glow" : "text-muted-foreground"}`}>
                <item.icon className="h-5 w-5" />
                <span className="text-[10px]">{item.label.split(" ")[0]}</span>
              </Link>
            );
          })}
        </div>

        <div className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-8 md:pt-10">
          <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
