import { PrismaClient } from '@prisma/client';
import { config } from './index';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: config.isDev ? ['query', 'error', 'warn'] : ['error'],
  });

if (config.isDev) globalForPrisma.prisma = prisma;

export async function connectDB(): Promise<void> {
  await prisma.$connect();
  console.log('✅ Database connected (SQLite)');
}

export async function disconnectDB(): Promise<void> {
  await prisma.$disconnect();
}
