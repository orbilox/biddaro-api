import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError } from '../utils/response';
import { AuthenticatedRequest } from '../types';

// ─── Public: get all active bank accounts (for deposit page) ─────────────────

export async function getBankSettings(req: AuthenticatedRequest, res: Response) {
  const banks = await prisma.bankSettings.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true, bankName: true, accountHolderName: true,
      accountNumber: true, routingNumber: true, ifscCode: true,
      swiftCode: true, ibanNumber: true, country: true, branch: true, bankAddress: true,
      paymentInstructions: true, sortOrder: true,
    },
  });
  sendSuccess(res, { banks });
}

// ─── Admin: get all bank accounts (including inactive) ───────────────────────

export async function adminGetBankSettings(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const banks = await prisma.bankSettings.findMany({
    orderBy: { sortOrder: 'asc' },
  });
  sendSuccess(res, { banks });
}

// ─── Admin: create a new bank account ────────────────────────────────────────

export async function adminCreateBankSettings(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const {
    bankName, accountHolderName, accountNumber,
    routingNumber, ifscCode, swiftCode, ibanNumber, country, branch,
    bankAddress, paymentInstructions, isActive, sortOrder,
  } = req.body;

  if (!bankName || !accountHolderName || !accountNumber) {
    return sendError(res, 'bankName, accountHolderName, and accountNumber are required', 400);
  }

  const bank = await prisma.bankSettings.create({
    data: {
      bankName, accountHolderName, accountNumber,
      routingNumber: routingNumber || null,
      ifscCode: ifscCode || null,
      swiftCode: swiftCode || null,
      ibanNumber: ibanNumber || null,
      country: country || null,
      branch: branch || null,
      bankAddress: bankAddress || null,
      paymentInstructions: paymentInstructions || null,
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder || 0,
    },
  });

  sendSuccess(res, { bank }, 'Bank account added successfully');
}

// ─── Admin: update a bank account ────────────────────────────────────────────

export async function adminUpdateBankSettings(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const { id } = req.params;
  const {
    bankName, accountHolderName, accountNumber,
    routingNumber, ifscCode, swiftCode, ibanNumber, country, branch,
    bankAddress, paymentInstructions, isActive, sortOrder,
  } = req.body;

  const existing = await prisma.bankSettings.findUnique({ where: { id } });
  if (!existing) return sendError(res, 'Bank account not found', 404);

  const bank = await prisma.bankSettings.update({
    where: { id },
    data: {
      ...(bankName !== undefined && { bankName }),
      ...(accountHolderName !== undefined && { accountHolderName }),
      ...(accountNumber !== undefined && { accountNumber }),
      ...(routingNumber !== undefined && { routingNumber }),
      ...(ifscCode !== undefined && { ifscCode }),
      ...(swiftCode !== undefined && { swiftCode }),
      ...(ibanNumber !== undefined && { ibanNumber }),
      ...(country !== undefined && { country }),
      ...(branch !== undefined && { branch }),
      ...(bankAddress !== undefined && { bankAddress }),
      ...(paymentInstructions !== undefined && { paymentInstructions }),
      ...(isActive !== undefined && { isActive }),
      ...(sortOrder !== undefined && { sortOrder }),
    },
  });

  sendSuccess(res, { bank }, 'Bank account updated successfully');
}

// ─── Admin: delete a bank account ────────────────────────────────────────────

export async function adminDeleteBankSettings(req: AuthenticatedRequest, res: Response) {
  if (req.user?.role !== 'admin') return sendError(res, 'Forbidden', 403);

  const { id } = req.params;
  const existing = await prisma.bankSettings.findUnique({ where: { id } });
  if (!existing) return sendError(res, 'Bank account not found', 404);

  await prisma.bankSettings.delete({ where: { id } });
  sendSuccess(res, null, 'Bank account deleted successfully');
}
