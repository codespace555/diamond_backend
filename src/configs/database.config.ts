import { myEnvironment } from "@/configs/env.config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const adapter = new PrismaPg({
  connectionString: myEnvironment.DATABASE_URL,
});

export const prisma =
  globalForPrisma.prisma ?? 
  new PrismaClient({
    adapter,
  });

if (myEnvironment.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}