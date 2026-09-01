import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Upload, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/payroll")({
  head: () => ({ meta: [{ title: "Fiches de paie — HorIA" }] }),
  component: PayrollPage,
});

function PayrollPage() {
  return (
    <AppShell title="Fiches de paie">
      <p className="-mt-6 text-muted-foreground">Importez votre bulletin, l'IA explique chaque ligne et détecte les anomalies.</p>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-dashed border-border p-8 text-center lg:col-span-1" style={{ background: "var(--gradient-surface)" }}>
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-accent/50">
            <Upload className="h-5 w-5 text-primary-glow" />
          </div>
          <h2 className="mt-3 font-display text-lg font-semibold">Nouveau bulletin</h2>
          <button className="mt-4 w-full rounded-lg px-4 py-2 text-sm font-medium text-primary-foreground" style={{ background: "var(--gradient-primary)" }}>
            Importer PDF
          </button>
        </div>

        <div className="rounded-2xl border border-border/60 p-6 lg:col-span-2" style={{ background: "var(--gradient-surface)" }}>
          <h2 className="font-display text-lg font-semibold">Historique</h2>
          <div className="mt-6 flex flex-col items-center justify-center py-10 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Aucune fiche pour l'instant.</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
