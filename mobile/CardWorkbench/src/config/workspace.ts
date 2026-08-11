export const WORKSPACE_PRODUCTION_ORIGIN =
  'https://xiaoke-sales-workspace.rich-mug-8653.chatgpt.site';

export const WORKSPACE_PRODUCTION_BASE_URL = `${WORKSPACE_PRODUCTION_ORIGIN}/`;

/**
 * Device pairing is deliberately pinned to the one production Sites origin.
 *
 * The custom-scheme pairing link still carries a short-lived dispatch token, so
 * it must never be logged or treated as a durable authentication mechanism.
 * The private Sites authorization gate remains a deployment dependency; a
 * future Universal Link migration should further reduce link interception risk.
 */
export function normalizePinnedWorkspaceBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (
    url.protocol !== 'https:' ||
    url.origin !== WORKSPACE_PRODUCTION_ORIGIN ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('Workspace origin is not allowed.');
  }
  return WORKSPACE_PRODUCTION_BASE_URL;
}
