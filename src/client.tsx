import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start/client";

/**
 * Point d'entrée client.
 *
 * Ce fichier reprend à l'identique l'entrée par défaut de TanStack Start.
 * On le déclare explicitement dans src/ parce que la version par défaut, située
 * dans node_modules, échappe au plugin React de Vite : son JSX est alors compilé
 * avec l'ancien runtime (`React.createElement`) sans que React soit importé.
 * Résultat en production : `ReferenceError: React is not defined` au moment de
 * l'hydratation — toute l'interactivité de l'application était morte (les
 * formulaires retombaient sur une soumission HTML native, aucun gestionnaire
 * React n'étant attaché).
 *
 * Placé ici, le fichier est compilé avec le runtime JSX automatique et le
 * problème disparaît.
 */
startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
