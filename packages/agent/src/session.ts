import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Directory holding the persistent browser profile (cookies + localStorage).
 *
 * This is how the agent stays signed in without ever handling a password:
 * you sign in once by hand (including via Google SSO), and the resulting
 * session lives here. Treat it as a secret — it grants access to the account.
 * It is gitignored.
 */
export const DEFAULT_PROFILE_DIR = '.agent-profile';

export function resolveProfileDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.AGENT_PROFILE_DIR ?? DEFAULT_PROFILE_DIR);
}

/** True once a sign-in has been performed at least once. */
export function profileExists(dir: string = resolveProfileDir()): boolean {
  return existsSync(dir);
}
