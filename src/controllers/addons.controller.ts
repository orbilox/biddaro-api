import { Response } from 'express';
import { prisma } from '../config/database';
import type { AuthenticatedRequest } from '../types';
import { ADDONS_CATALOG, getAddOn } from '../config/addons.catalog';
import { sendSuccess, sendError } from '../utils/response';

// ─── List catalog (with user's installed status) ──────────────────────────────

export async function listAddOns(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;

  const installed = await prisma.userAddOn.findMany({
    where: { userId, isActive: true },
    select: { addOnSlug: true, installedAt: true },
  });

  const installedSlugs = new Set(installed.map((i) => i.addOnSlug));
  const installedMap = new Map(installed.map((i) => [i.addOnSlug, i.installedAt]));

  const catalog = ADDONS_CATALOG.map((addon) => ({
    ...addon,
    isInstalled: installedSlugs.has(addon.slug),
    installedAt: installedMap.get(addon.slug) ?? null,
  }));

  sendSuccess(res, catalog);
}

// ─── Get installed add-ons for a user ────────────────────────────────────────

export async function getInstalledAddOns(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;

  const installed = await prisma.userAddOn.findMany({
    where: { userId, isActive: true },
    orderBy: { installedAt: 'desc' },
  });

  const enriched = installed.map((record) => ({
    ...record,
    addon: getAddOn(record.addOnSlug) ?? null,
  }));

  sendSuccess(res, enriched);
}

// ─── Install an add-on ────────────────────────────────────────────────────────

export async function installAddOn(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { slug } = req.params;

  const definition = getAddOn(slug);
  if (!definition) {
    sendError(res, 'Add-on not found', 404);
    return;
  }

  if (definition.comingSoon) {
    sendError(res, 'This add-on is not yet available');
    return;
  }

  // Check role eligibility
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) { sendError(res, 'User not found', 404); return; }

  const isContractor = user.role === 'contractor';
  const isPoster     = user.role === 'job_poster';
  if (
    (definition.targetRole === 'contractor' && !isContractor) ||
    (definition.targetRole === 'job_poster' && !isPoster)
  ) {
    sendError(res, `This add-on is only available for ${definition.targetRole === 'contractor' ? 'contractors' : 'job posters'}`);
    return;
  }

  // Check if already installed
  const existing = await prisma.userAddOn.findUnique({
    where: { userId_addOnSlug: { userId, addOnSlug: slug } },
  });
  if (existing?.isActive) {
    sendError(res, 'Add-on is already installed');
    return;
  }

  // Debit wallet for paid add-ons
  if (definition.price > 0) {
    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet || wallet.balance < definition.price) {
      sendError(res, `Insufficient wallet balance. Required: $${definition.price.toFixed(2)}`);
      return;
    }

    await prisma.wallet.update({
      where: { userId },
      data: { balance: { decrement: definition.price } },
    });

    await prisma.transaction.create({
      data: {
        userId,
        type: 'debit',
        amount: definition.price,
        description: `Add-on: ${definition.name}`,
        status: 'completed',
        metadata: JSON.stringify({ addon: slug }),
      },
    });
  }

  // Create or reactivate installation
  if (existing) {
    await prisma.userAddOn.update({
      where: { userId_addOnSlug: { userId, addOnSlug: slug } },
      data: { isActive: true, installedAt: new Date() },
    });
  } else {
    await prisma.userAddOn.create({
      data: { userId, addOnSlug: slug },
    });
  }

  sendSuccess(res, { slug, name: definition.name }, `${definition.name} installed successfully!`);
}

// ─── Uninstall an add-on ──────────────────────────────────────────────────────

export async function uninstallAddOn(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { slug } = req.params;

  const existing = await prisma.userAddOn.findUnique({
    where: { userId_addOnSlug: { userId, addOnSlug: slug } },
  });

  if (!existing || !existing.isActive) {
    sendError(res, 'Add-on is not installed', 404);
    return;
  }

  await prisma.userAddOn.update({
    where: { userId_addOnSlug: { userId, addOnSlug: slug } },
    data: { isActive: false },
  });

  const definition = getAddOn(slug);
  sendSuccess(res, { slug }, `${definition?.name ?? slug} has been uninstalled`);
}

// ─── Check if user has a specific add-on installed ───────────────────────────

export async function checkAddOn(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const { slug } = req.params;

  const record = await prisma.userAddOn.findUnique({
    where: { userId_addOnSlug: { userId, addOnSlug: slug } },
  });

  sendSuccess(res, { slug, isInstalled: !!(record?.isActive) });
}
