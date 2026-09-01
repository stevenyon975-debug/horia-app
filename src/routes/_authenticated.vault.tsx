import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Search, Upload, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/vault")({
  head: () => ({ meta: [{ title: "Coffre-fort — HorIA" }] }),
  component: VaultPage,
});

function VaultPage() {
  return (
    <AppShell title="Coffre-fort">
      <p className="-mt-6 text-muted-foreground">Stockage sécurisé, classement automatique et recherche intelligente.</p>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            placeholder="Rechercher un document…"
            className="w-full rounded-lg border border-border bg-card/50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary"
          />
        </div>
        <button className="flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>
          <Upload className="h-4 w-4" /> Importer
        </button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {["Contrats", "Paie", "Attestations", "Autres"].map((c) => (
          <div key={c} className="rounded-2xl border border-border/60 p-5" style={{ background: "var(--gradient-surface)" }}>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{c}</div>
            <div className="mt-1 font-display text-2xl font-bold">0</div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-border/60 p-12 text-center" style={{ background: "var(--gradient-surface)" }}>
        <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Votre coffre-fort est vide.</p>
      </div>
    </AppShell>
  );
}
