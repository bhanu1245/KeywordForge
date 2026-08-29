/**
 * Cookie name only — deliberately its own module with ZERO imports.
 *
 * `middleware.ts` runs in the Edge runtime, which has no `node:crypto` and no
 * Prisma. Importing this constant from `session.ts` pulled that whole module
 * (and its Node built-ins) into the edge bundle and produced a build warning.
 * Keeping the shared name here lets middleware and the server code agree on it
 * without dragging server-only dependencies across the boundary.
 */
export const SESSION_COOKIE = "kf_session";
