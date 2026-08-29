/**
 * Environment gating for security-sensitive branches.
 *
 * THE RULE: never write `NODE_ENV !== "production"` to guard an unsafe path.
 *
 * That test is an allow-by-default: an unset, empty, or mistyped NODE_ENV —
 * the default in plenty of deployment setups, and in any bare `node server.js`
 * — takes the unsafe branch. The failure is silent, because nothing looks
 * wrong until the consequence shows up in production.
 *
 * Instead, name the safe environments explicitly. Anything unrecognised gets
 * production behaviour, so a misconfiguration fails closed.
 *
 * Deliberately dependency-free so the Edge runtime (middleware) can use it.
 */

const LOCAL_ENVS = new Set(["development", "test"]);

/**
 * Pure predicate over a specific value.
 *
 * Kept separate from `isLocalEnv()` on purpose. A single function with a
 * default parameter (`env = process.env.NODE_ENV`) is a trap: calling it with
 * an explicitly `undefined` value triggers the default and silently reads the
 * ambient environment instead — so a call site forwarding a possibly-undefined
 * variable would get "true" on a machine where NODE_ENV happens to be set.
 * Here, `undefined` means `undefined` and returns false.
 */
export function isLocalEnvValue(env: string | undefined | null): boolean {
  return LOCAL_ENVS.has(env ?? "");
}

/**
 * True ONLY for an explicitly declared local environment.
 *
 * Unset, "", "staging", "prod", "Production", a typo — all return false, and
 * the caller takes the safe path.
 */
export function isLocalEnv(): boolean {
  return isLocalEnvValue(process.env.NODE_ENV);
}
