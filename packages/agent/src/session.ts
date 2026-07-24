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

/**
 * Repo root, derived from this file's location rather than `process.cwd()`.
 * `npm run -w <pkg>` sets cwd to the package directory, so a cwd-relative path
 * would put the profile somewhere different depending on how you invoked it.
 */
export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * Absolute path to the profile directory. Override with `AGENT_PROFILE_DIR`
 * (resolved against cwd, so an explicit override behaves as typed).
 */
export function resolveProfileDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.AGENT_PROFILE_DIR;
  return override ? path.resolve(override) : path.join(REPO_ROOT, DEFAULT_PROFILE_DIR);
}

/** True once a sign-in has been performed at least once. */
export function profileExists(dir: string = resolveProfileDir()): boolean {
  return existsSync(dir);
}
