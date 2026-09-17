/**
 * Shareable clone: no federated identity providers.
 * App-level Better Auth / Google / X sign-in is disabled.
 */
export type GrokProvider = {
  providerId: string;
  idp: string;
  label: string;
};

export const GROK_PROVIDERS: readonly GrokProvider[] = [];
