import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Mail, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/emails")({
  head: () => ({ meta: [{ title: "E-mails — HorIA" }] }),
  component: EmailsPage,
});

function EmailsPage() {
  return (
    <AppShell title="Assistant e-mail">
      <p className="-mt-6 text-muted-foreground">Résumés, actions importantes et réponses proposées par l'IA.</p>

      <div className="mt-8 rounded-2xl border border-border/60 p-6" style={{ background: "var(--gradient-surface)" }}>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent/50">
            <Mail className="h-5 w-5 text-primary-glow" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">Connectez votre messagerie</h2>
            <p className="text-sm text-muted-foreground">Gmail, Outlook ou IMAP — bientôt disponible.</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Gmail</button>
          <button className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">Outlook</button>
          <button className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">IMAP</button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border/60 p-12 text-center" style={{ background: "var(--gradient-surface)" }}>
        <Sparkles className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">Aucun e-mail à analyser pour le moment.</p>
      </div>
    </AppShell>
  );
}
