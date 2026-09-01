// Lovable integration stub — Google OAuth removed, using Magic Link instead.
// This file is kept as an empty export to avoid breaking any remaining imports.
export const lovable = {
  auth: {
    signInWithOAuth: async (_provider: string, _opts?: unknown) => {
      throw new Error('OAuth via Lovable is not available. Use Magic Link instead.');
    },
  },
};
