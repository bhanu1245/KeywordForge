import { PrismaClient } from "@prisma/client";

// Next dev reloads modules on every edit; without the global cache each reload
// opens a new pool and SQLite starts throwing "too many connections".
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
