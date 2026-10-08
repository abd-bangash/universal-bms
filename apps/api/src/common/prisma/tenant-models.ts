import { TENANT_MODEL_NAMES } from './tenant-models.generated';

/**
 * Models that are deliberately not workspace-scoped (design.md, plus the two the design table cannot
 * hold: Workspace itself is the tenant, and LoginAttempt is written before a workspace is known).
 */
export const GLOBAL_MODELS: ReadonlySet<string> = new Set([
  'User',
  'UserSession',
  'PasswordResetToken',
  'IndustryProfile',
  'PlatformSetting',
  'Workspace',
  'LoginAttempt',
  // received before the workspace is known; resolved from the account id afterwards
  'WebhookEvent',
]);

/** Every model with a `workspaceId` column; the tenant extension scopes exactly these. */
export const TENANT_MODELS: ReadonlySet<string> = new Set(TENANT_MODEL_NAMES);
