/**
 * Site Manager Add-On — construction ERP for active sites.
 * Models: SiteProject, SiteLabor, LaborAttendance, SiteMaterial, MaterialTransaction,
 *         DailyReport, BOQItem, SiteEquipment, SiteExpense, SiteInvoice, SiteSubcontractor
 */

import { Response } from 'express';
import { prisma } from '../config/database';
import { sendSuccess, sendError, sendNotFound, sendForbidden } from '../utils/response';
import { getPagination, buildPaginatedResult } from '../utils/pagination';
import type { AuthenticatedRequest } from '../types';

// ─── Helper: ownership guard ──────────────────────────────────────────────────

async function getOwnedSite(siteId: string, userId: string) {
  return prisma.siteProject.findFirst({ where: { id: siteId, userId } });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SITE PROJECTS
// ═══════════════════════════════════════════════════════════════════════════════

export async function listSites(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { page, limit, skip } = getPagination(req as any);
  const userId = req.user!.userId;

  const [sites, total] = await Promise.all([
    prisma.siteProject.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        _count: {
          select: {
            labor: true,
            boqItems: true,
            reports: true,
            expenses: true,
          },
        },
      },
    }),
    prisma.siteProject.count({ where: { userId } }),
  ]);

  sendSuccess(res, buildPaginatedResult(sites, total, { page, limit, skip }));
}

export async function createSite(req: AuthenticatedRequest, res: Response): Promise<void> {
  const userId = req.user!.userId;
  const {
    name, description, location, latitude, longitude,
    startDate, endDate, budget, currency, clientName, clientPhone, clientEmail,
  } = req.body;

  if (!name) { sendError(res, 'name is required', 400); return; }

  const site = await prisma.siteProject.create({
    data: {
      userId,
      name,
      description,
      location,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      budget: budget ? parseFloat(budget) : 0,
      currency: currency || 'INR',
      clientName,
      clientPhone,
      clientEmail,
    },
  });

  sendSuccess(res, site, 'Site created');
}

export async function getSite(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;

  const site = await prisma.siteProject.findFirst({
    where: { id: siteId, userId },
    include: {
      _count: {
        select: {
          labor: { where: { status: 'active' } },
          boqItems: true,
          reports: true,
          expenses: true,
          invoices: true,
          subcontractors: true,
          equipment: true,
          materials: true,
        },
      },
    },
  });

  if (!site) { sendNotFound(res, 'Site'); return; }
  sendSuccess(res, site);
}

export async function updateSite(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;

  const site = await getOwnedSite(siteId, userId);
  if (!site) { sendNotFound(res, 'Site'); return; }

  const allowed = [
    'name','description','location','latitude','longitude','startDate','endDate',
    'status','budget','currency','clientName','clientPhone','clientEmail','coverImage','progressPct',
  ];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (['latitude','longitude','budget','progressPct'].includes(key)) {
        data[key] = parseFloat(req.body[key]);
      } else if (['startDate','endDate'].includes(key)) {
        data[key] = req.body[key] ? new Date(req.body[key]) : null;
      } else {
        data[key] = req.body[key];
      }
    }
  }

  const updated = await prisma.siteProject.update({ where: { id: siteId }, data });
  sendSuccess(res, updated, 'Site updated');
}

export async function deleteSite(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;

  const site = await getOwnedSite(siteId, userId);
  if (!site) { sendNotFound(res, 'Site'); return; }

  await prisma.siteProject.delete({ where: { id: siteId } });
  sendSuccess(res, null, 'Site deleted');
}

export async function getSiteStats(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;

  const site = await getOwnedSite(siteId, userId);
  if (!site) { sendNotFound(res, 'Site'); return; }

  const [
    laborCount,
    todayAttendance,
    totalExpenses,
    boqTotal,
    boqCompleted,
    lastReport,
  ] = await Promise.all([
    prisma.siteLabor.count({ where: { siteId, status: 'active' } }),
    prisma.laborAttendance.count({
      where: {
        siteId,
        date: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt:  new Date(new Date().setHours(23, 59, 59, 999)),
        },
        status: { not: 'absent' },
      },
    }),
    prisma.siteExpense.aggregate({ where: { siteId }, _sum: { amount: true } }),
    prisma.bOQItem.aggregate({ where: { siteId }, _sum: { totalAmount: true } }),
    prisma.bOQItem.aggregate({
      where: { siteId },
      _sum: { completedQty: true },
    }),
    prisma.dailyReport.findFirst({
      where: { siteId },
      orderBy: { reportDate: 'desc' },
    }),
  ]);

  const budgetUsed = totalExpenses._sum.amount || 0;
  const budgetTotal = site.budget;
  const budgetPct = budgetTotal > 0 ? Math.round((budgetUsed / budgetTotal) * 100) : 0;

  sendSuccess(res, {
    laborCount,
    todayAttendance,
    budgetUsed,
    budgetTotal,
    budgetPct,
    boqTotal: boqTotal._sum.totalAmount || 0,
    progressPct: lastReport?.progressPct || site.progressPct,
    lastReportDate: lastReport?.reportDate || null,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// LABOR
// ═══════════════════════════════════════════════════════════════════════════════

export async function listLabor(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const labor = await prisma.siteLabor.findMany({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
  });
  sendSuccess(res, labor);
}

export async function addLabor(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { name, phone, role, dailyWage, currency, joinDate } = req.body;
  if (!name) { sendError(res, 'name is required', 400); return; }

  const labor = await prisma.siteLabor.create({
    data: {
      siteId,
      name,
      phone,
      role: role || 'helper',
      dailyWage: dailyWage ? parseFloat(dailyWage) : 0,
      currency: currency || 'INR',
      joinDate: joinDate ? new Date(joinDate) : new Date(),
    },
  });
  sendSuccess(res, labor, 'Labor added');
}

export async function updateLabor(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, laborId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const labor = await prisma.siteLabor.findFirst({ where: { id: laborId, siteId } });
  if (!labor) { sendNotFound(res, 'Labor'); return; }

  const data: Record<string, unknown> = {};
  const fields = ['name','phone','role','dailyWage','currency','status'];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      data[f] = f === 'dailyWage' ? parseFloat(req.body[f]) : req.body[f];
    }
  }
  const updated = await prisma.siteLabor.update({ where: { id: laborId }, data });
  sendSuccess(res, updated);
}

export async function deleteLabor(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, laborId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  await prisma.siteLabor.delete({ where: { id: laborId } });
  sendSuccess(res, null, 'Labor removed');
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════════════════════════════════════

export async function listAttendance(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { date } = req.query;
  const whereDate = date
    ? { gte: new Date(date as string), lt: new Date(new Date(date as string).setDate(new Date(date as string).getDate() + 1)) }
    : undefined;

  const records = await prisma.laborAttendance.findMany({
    where: { siteId, ...(whereDate ? { date: whereDate } : {}) },
    include: { labor: { select: { id: true, name: true, role: true, dailyWage: true } } },
    orderBy: { date: 'desc' },
  });
  sendSuccess(res, records);
}

export async function markAttendance(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { laborId, date, status, checkInTime, checkOutTime, checkInLat, checkInLng, hoursWorked, notes } = req.body;
  if (!laborId || !date) { sendError(res, 'laborId and date are required', 400); return; }

  const labor = await prisma.siteLabor.findFirst({ where: { id: laborId, siteId } });
  if (!labor) { sendNotFound(res, 'Labor'); return; }

  const parsedDate = new Date(date);
  parsedDate.setHours(0, 0, 0, 0);

  const hrs = hoursWorked ? parseFloat(hoursWorked) : (status === 'half_day' ? 4 : status === 'absent' ? 0 : 8);
  const wageMultiplier = status === 'half_day' ? 0.5 : status === 'absent' ? 0 : (status === 'overtime' ? 1.5 : 1);
  const wageForDay = labor.dailyWage * wageMultiplier;

  const record = await prisma.laborAttendance.upsert({
    where: { laborId_date: { laborId, date: parsedDate } },
    update: {
      status: status || 'present',
      checkInTime,
      checkOutTime,
      checkInLat: checkInLat ? parseFloat(checkInLat) : null,
      checkInLng: checkInLng ? parseFloat(checkInLng) : null,
      hoursWorked: hrs,
      wageForDay,
      notes,
    },
    create: {
      siteId,
      laborId,
      date: parsedDate,
      status: status || 'present',
      checkInTime,
      checkOutTime,
      checkInLat: checkInLat ? parseFloat(checkInLat) : null,
      checkInLng: checkInLng ? parseFloat(checkInLng) : null,
      hoursWorked: hrs,
      wageForDay,
      notes,
    },
  });
  sendSuccess(res, record, 'Attendance saved');
}

export async function bulkMarkAttendance(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { date, records } = req.body; // records: [{ laborId, status, checkInTime, checkOutTime }]
  if (!date || !Array.isArray(records)) { sendError(res, 'date and records[] required', 400); return; }

  const parsedDate = new Date(date);
  parsedDate.setHours(0, 0, 0, 0);

  const labor = await prisma.siteLabor.findMany({ where: { siteId } });
  const laborMap = new Map(labor.map(l => [l.id, l]));

  const upserts = records.map((r: any) => {
    const l = laborMap.get(r.laborId);
    if (!l) return null;
    const wageMultiplier = r.status === 'half_day' ? 0.5 : r.status === 'absent' ? 0 : (r.status === 'overtime' ? 1.5 : 1);
    return prisma.laborAttendance.upsert({
      where: { laborId_date: { laborId: r.laborId, date: parsedDate } },
      update: { status: r.status || 'present', checkInTime: r.checkInTime, checkOutTime: r.checkOutTime, wageForDay: l.dailyWage * wageMultiplier },
      create: { siteId, laborId: r.laborId, date: parsedDate, status: r.status || 'present', checkInTime: r.checkInTime, checkOutTime: r.checkOutTime, wageForDay: l.dailyWage * wageMultiplier, hoursWorked: r.status === 'half_day' ? 4 : r.status === 'absent' ? 0 : 8 },
    });
  }).filter(Boolean);

  await Promise.all(upserts);
  sendSuccess(res, null, 'Bulk attendance saved');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MATERIALS
// ═══════════════════════════════════════════════════════════════════════════════

export async function listMaterials(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const materials = await prisma.siteMaterial.findMany({
    where: { siteId },
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { transactions: true } },
    },
  });
  sendSuccess(res, materials);
}

export async function addMaterial(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { name, category, unit, currentStock, minStock, unitCost, currency } = req.body;
  if (!name) { sendError(res, 'name is required', 400); return; }

  const mat = await prisma.siteMaterial.create({
    data: {
      siteId,
      name,
      category: category || 'other',
      unit: unit || 'pcs',
      currentStock: currentStock ? parseFloat(currentStock) : 0,
      minStock: minStock ? parseFloat(minStock) : 0,
      unitCost: unitCost ? parseFloat(unitCost) : 0,
      currency: currency || 'INR',
    },
  });
  sendSuccess(res, mat, 'Material added');
}

export async function updateMaterial(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, materialId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const mat = await prisma.siteMaterial.findFirst({ where: { id: materialId, siteId } });
  if (!mat) { sendNotFound(res, 'Material'); return; }

  const data: Record<string, unknown> = {};
  const numFields = ['currentStock','minStock','unitCost'];
  const strFields = ['name','category','unit','currency'];
  for (const f of [...numFields, ...strFields]) {
    if (req.body[f] !== undefined) {
      data[f] = numFields.includes(f) ? parseFloat(req.body[f]) : req.body[f];
    }
  }
  const updated = await prisma.siteMaterial.update({ where: { id: materialId }, data });
  sendSuccess(res, updated);
}

export async function deleteMaterial(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, materialId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  await prisma.siteMaterial.delete({ where: { id: materialId } });
  sendSuccess(res, null, 'Material deleted');
}

export async function listMaterialTransactions(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, materialId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const txns = await prisma.materialTransaction.findMany({
    where: { siteId, materialId },
    orderBy: { date: 'desc' },
    take: 100,
  });
  sendSuccess(res, txns);
}

export async function addMaterialTransaction(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, materialId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const mat = await prisma.siteMaterial.findFirst({ where: { id: materialId, siteId } });
  if (!mat) { sendNotFound(res, 'Material'); return; }

  const { type, quantity, unitCost, vendor, invoiceNumber, notes, date } = req.body;
  if (!type || !quantity) { sendError(res, 'type and quantity are required', 400); return; }

  const qty = parseFloat(quantity);
  const cost = unitCost ? parseFloat(unitCost) : mat.unitCost;
  const total = qty * cost;

  // Adjust stock
  const stockDelta = ['received'].includes(type) ? qty : -qty;

  await prisma.$transaction([
    prisma.materialTransaction.create({
      data: {
        siteId,
        materialId,
        type,
        quantity: qty,
        unitCost: cost,
        totalCost: total,
        vendor,
        invoiceNumber,
        notes,
        date: date ? new Date(date) : new Date(),
      },
    }),
    prisma.siteMaterial.update({
      where: { id: materialId },
      data: { currentStock: { increment: stockDelta } },
    }),
  ]);

  sendSuccess(res, null, 'Transaction recorded');
}

// ═══════════════════════════════════════════════════════════════════════════════
// DAILY REPORTS (DPR)
// ═══════════════════════════════════════════════════════════════════════════════

export async function listReports(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const reports = await prisma.dailyReport.findMany({
    where: { siteId },
    orderBy: { reportDate: 'desc' },
    take: 90,
  });
  sendSuccess(res, reports);
}

export async function upsertReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { reportDate, weather, workDone, labourCount, issues, photos, nextDayPlan, progressPct } = req.body;
  if (!reportDate) { sendError(res, 'reportDate is required', 400); return; }

  const parsedDate = new Date(reportDate);
  parsedDate.setHours(0, 0, 0, 0);

  const report = await prisma.dailyReport.upsert({
    where: { siteId_reportDate: { siteId, reportDate: parsedDate } },
    update: {
      weather, workDone,
      labourCount: labourCount ? parseInt(labourCount) : 0,
      issues, photos: photos ? JSON.stringify(photos) : null,
      nextDayPlan,
      progressPct: progressPct ? parseFloat(progressPct) : 0,
    },
    create: {
      siteId,
      reportDate: parsedDate,
      weather, workDone,
      labourCount: labourCount ? parseInt(labourCount) : 0,
      issues, photos: photos ? JSON.stringify(photos) : null,
      nextDayPlan,
      progressPct: progressPct ? parseFloat(progressPct) : 0,
      createdBy: userId,
    },
  });

  // Update site progress
  if (progressPct !== undefined) {
    await prisma.siteProject.update({
      where: { id: siteId },
      data: { progressPct: parseFloat(progressPct) },
    });
  }

  sendSuccess(res, report, 'Report saved');
}

export async function deleteReport(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, reportId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  await prisma.dailyReport.delete({ where: { id: reportId } });
  sendSuccess(res, null, 'Report deleted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOQ — Bill of Quantities
// ═══════════════════════════════════════════════════════════════════════════════

export async function listBOQ(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const items = await prisma.bOQItem.findMany({
    where: { siteId },
    orderBy: [{ category: 'asc' }, { createdAt: 'asc' }],
  });
  sendSuccess(res, items);
}

export async function addBOQItem(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { category, description, unit, quantity, unitRate, notes } = req.body;
  if (!description || !unit || !quantity || !unitRate) {
    sendError(res, 'description, unit, quantity, and unitRate are required', 400); return;
  }

  const qty = parseFloat(quantity);
  const rate = parseFloat(unitRate);
  const item = await prisma.bOQItem.create({
    data: {
      siteId,
      category: category || 'civil',
      description,
      unit,
      quantity: qty,
      unitRate: rate,
      totalAmount: qty * rate,
      notes,
    },
  });
  sendSuccess(res, item, 'BOQ item added');
}

export async function updateBOQItem(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, itemId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const existing = await prisma.bOQItem.findFirst({ where: { id: itemId, siteId } });
  if (!existing) { sendNotFound(res, 'BOQ Item'); return; }

  const { category, description, unit, quantity, unitRate, completedQty, notes } = req.body;
  const qty = quantity !== undefined ? parseFloat(quantity) : existing.quantity;
  const rate = unitRate !== undefined ? parseFloat(unitRate) : existing.unitRate;

  const updated = await prisma.bOQItem.update({
    where: { id: itemId },
    data: {
      category: category ?? existing.category,
      description: description ?? existing.description,
      unit: unit ?? existing.unit,
      quantity: qty,
      unitRate: rate,
      totalAmount: qty * rate,
      completedQty: completedQty !== undefined ? parseFloat(completedQty) : existing.completedQty,
      notes: notes ?? existing.notes,
    },
  });
  sendSuccess(res, updated);
}

export async function deleteBOQItem(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, itemId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  await prisma.bOQItem.delete({ where: { id: itemId } });
  sendSuccess(res, null, 'BOQ item deleted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQUIPMENT
// ═══════════════════════════════════════════════════════════════════════════════

export async function listEquipment(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const equipment = await prisma.siteEquipment.findMany({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
  });
  sendSuccess(res, equipment);
}

export async function addEquipment(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { name, type, category, serialNumber, vendor, dailyRate, currency, startDate, endDate, notes } = req.body;
  if (!name) { sendError(res, 'name is required', 400); return; }

  const eq = await prisma.siteEquipment.create({
    data: {
      siteId, name,
      type: type || 'owned',
      category: category || 'other',
      serialNumber, vendor,
      dailyRate: dailyRate ? parseFloat(dailyRate) : 0,
      currency: currency || 'INR',
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      notes,
    },
  });
  sendSuccess(res, eq, 'Equipment added');
}

export async function updateEquipment(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, equipId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const eq = await prisma.siteEquipment.findFirst({ where: { id: equipId, siteId } });
  if (!eq) { sendNotFound(res, 'Equipment'); return; }

  const data: Record<string, unknown> = {};
  const fields = ['name','type','category','serialNumber','vendor','dailyRate','currency','status','notes'];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      data[f] = f === 'dailyRate' ? parseFloat(req.body[f]) : req.body[f];
    }
  }
  if (req.body.startDate !== undefined) data.startDate = req.body.startDate ? new Date(req.body.startDate) : null;
  if (req.body.endDate !== undefined) data.endDate = req.body.endDate ? new Date(req.body.endDate) : null;

  const updated = await prisma.siteEquipment.update({ where: { id: equipId }, data });
  sendSuccess(res, updated);
}

export async function deleteEquipment(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, equipId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  await prisma.siteEquipment.delete({ where: { id: equipId } });
  sendSuccess(res, null, 'Equipment deleted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPENSES
// ═══════════════════════════════════════════════════════════════════════════════

export async function listExpenses(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const expenses = await prisma.siteExpense.findMany({
    where: { siteId },
    orderBy: { date: 'desc' },
  });
  sendSuccess(res, expenses);
}

export async function addExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { category, description, amount, currency, date, vendor, invoiceNumber, receiptUrl, notes } = req.body;
  if (!category || !description || !amount) {
    sendError(res, 'category, description, and amount are required', 400); return;
  }

  const expense = await prisma.siteExpense.create({
    data: {
      siteId, category, description,
      amount: parseFloat(amount),
      currency: currency || 'INR',
      date: date ? new Date(date) : new Date(),
      vendor, invoiceNumber, receiptUrl, notes,
    },
  });
  sendSuccess(res, expense, 'Expense recorded');
}

export async function deleteExpense(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, expenseId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  await prisma.siteExpense.delete({ where: { id: expenseId } });
  sendSuccess(res, null, 'Expense deleted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════════════════════════════════════════

export async function listInvoices(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const invoices = await prisma.siteInvoice.findMany({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
  });
  sendSuccess(res, invoices);
}

export async function createInvoice(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  const site = await getOwnedSite(siteId, userId);
  if (!site) { sendNotFound(res, 'Site'); return; }

  const { invoiceNumber, clientName, clientEmail, amount, taxAmount, currency, dueDate, notes, lineItems } = req.body;
  if (!clientName || !amount) { sendError(res, 'clientName and amount are required', 400); return; }

  const amt = parseFloat(amount);
  const tax = taxAmount ? parseFloat(taxAmount) : 0;
  const invNum = invoiceNumber || `INV-${siteId.slice(-4).toUpperCase()}-${Date.now().toString().slice(-6)}`;

  const invoice = await prisma.siteInvoice.create({
    data: {
      siteId,
      invoiceNumber: invNum,
      clientName: clientName || site.clientName || '',
      clientEmail: clientEmail || site.clientEmail || null,
      amount: amt,
      taxAmount: tax,
      totalAmount: amt + tax,
      currency: currency || 'INR',
      dueDate: dueDate ? new Date(dueDate) : null,
      notes,
      lineItems: lineItems ? JSON.stringify(lineItems) : null,
    },
  });
  sendSuccess(res, invoice, 'Invoice created');
}

export async function updateInvoice(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, invoiceId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const inv = await prisma.siteInvoice.findFirst({ where: { id: invoiceId, siteId } });
  if (!inv) { sendNotFound(res, 'Invoice'); return; }

  const data: Record<string, unknown> = {};
  const strFields = ['invoiceNumber','clientName','clientEmail','currency','notes','status'];
  const numFields = ['amount','taxAmount'];
  for (const f of [...strFields, ...numFields]) {
    if (req.body[f] !== undefined) {
      data[f] = numFields.includes(f) ? parseFloat(req.body[f]) : req.body[f];
    }
  }
  if (req.body.dueDate !== undefined) data.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
  if (req.body.paidDate !== undefined) data.paidDate = req.body.paidDate ? new Date(req.body.paidDate) : null;
  if (req.body.lineItems !== undefined) data.lineItems = JSON.stringify(req.body.lineItems);
  if (data.amount !== undefined || data.taxAmount !== undefined) {
    const amt = (data.amount as number) ?? inv.amount;
    const tax = (data.taxAmount as number) ?? inv.taxAmount;
    data.totalAmount = amt + tax;
  }

  const updated = await prisma.siteInvoice.update({ where: { id: invoiceId }, data });
  sendSuccess(res, updated);
}

export async function deleteInvoice(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, invoiceId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  await prisma.siteInvoice.delete({ where: { id: invoiceId } });
  sendSuccess(res, null, 'Invoice deleted');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBCONTRACTORS
// ═══════════════════════════════════════════════════════════════════════════════

export async function listSubcontractors(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const subs = await prisma.siteSubcontractor.findMany({
    where: { siteId },
    orderBy: { createdAt: 'desc' },
  });
  sendSuccess(res, subs);
}

export async function addSubcontractor(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const { name, company, phone, email, specialty, contractValue, currency, startDate, endDate, notes } = req.body;
  if (!name) { sendError(res, 'name is required', 400); return; }

  const sub = await prisma.siteSubcontractor.create({
    data: {
      siteId, name, company, phone, email,
      specialty: specialty || 'civil',
      contractValue: contractValue ? parseFloat(contractValue) : 0,
      currency: currency || 'INR',
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      notes,
    },
  });
  sendSuccess(res, sub, 'Subcontractor added');
}

export async function updateSubcontractor(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, subId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  const sub = await prisma.siteSubcontractor.findFirst({ where: { id: subId, siteId } });
  if (!sub) { sendNotFound(res, 'Subcontractor'); return; }

  const data: Record<string, unknown> = {};
  const strFields = ['name','company','phone','email','specialty','currency','status','notes'];
  const numFields = ['contractValue','paidAmount'];
  for (const f of [...strFields, ...numFields]) {
    if (req.body[f] !== undefined) {
      data[f] = numFields.includes(f) ? parseFloat(req.body[f]) : req.body[f];
    }
  }
  if (req.body.startDate !== undefined) data.startDate = req.body.startDate ? new Date(req.body.startDate) : null;
  if (req.body.endDate !== undefined) data.endDate = req.body.endDate ? new Date(req.body.endDate) : null;

  const updated = await prisma.siteSubcontractor.update({ where: { id: subId }, data });
  sendSuccess(res, updated);
}

export async function deleteSubcontractor(req: AuthenticatedRequest, res: Response): Promise<void> {
  const { siteId, subId } = req.params;
  const userId = req.user!.userId;
  if (!await getOwnedSite(siteId, userId)) { sendNotFound(res, 'Site'); return; }

  await prisma.siteSubcontractor.delete({ where: { id: subId } });
  sendSuccess(res, null, 'Subcontractor removed');
}
