import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  // Sites
  listSites, createSite, getSite, updateSite, deleteSite, getSiteStats,
  // Labor
  listLabor, addLabor, updateLabor, deleteLabor,
  // Attendance
  listAttendance, markAttendance, bulkMarkAttendance,
  // Materials
  listMaterials, addMaterial, updateMaterial, deleteMaterial,
  listMaterialTransactions, addMaterialTransaction,
  // Reports
  listReports, upsertReport, deleteReport,
  // BOQ
  listBOQ, addBOQItem, updateBOQItem, deleteBOQItem,
  // Equipment
  listEquipment, addEquipment, updateEquipment, deleteEquipment,
  // Expenses
  listExpenses, addExpense, deleteExpense,
  // Invoices
  listInvoices, createInvoice, updateInvoice, deleteInvoice,
  // Subcontractors
  listSubcontractors, addSubcontractor, updateSubcontractor, deleteSubcontractor,
} from '../controllers/siteManager.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── Sites ────────────────────────────────────────────────────────────────────
router.get('/sites',              listSites);
router.post('/sites',             createSite);
router.get('/sites/:siteId',      getSite);
router.put('/sites/:siteId',      updateSite);
router.delete('/sites/:siteId',   deleteSite);
router.get('/sites/:siteId/stats', getSiteStats);

// ─── Labor ────────────────────────────────────────────────────────────────────
router.get('/sites/:siteId/labor',            listLabor);
router.post('/sites/:siteId/labor',           addLabor);
router.put('/sites/:siteId/labor/:laborId',   updateLabor);
router.delete('/sites/:siteId/labor/:laborId', deleteLabor);

// ─── Attendance ───────────────────────────────────────────────────────────────
router.get('/sites/:siteId/attendance',       listAttendance);
router.post('/sites/:siteId/attendance',      markAttendance);
router.post('/sites/:siteId/attendance/bulk', bulkMarkAttendance);

// ─── Materials ────────────────────────────────────────────────────────────────
router.get('/sites/:siteId/materials',                             listMaterials);
router.post('/sites/:siteId/materials',                            addMaterial);
router.put('/sites/:siteId/materials/:materialId',                 updateMaterial);
router.delete('/sites/:siteId/materials/:materialId',              deleteMaterial);
router.get('/sites/:siteId/materials/:materialId/transactions',    listMaterialTransactions);
router.post('/sites/:siteId/materials/:materialId/transactions',   addMaterialTransaction);

// ─── Daily Reports ────────────────────────────────────────────────────────────
router.get('/sites/:siteId/reports',              listReports);
router.post('/sites/:siteId/reports',             upsertReport);
router.delete('/sites/:siteId/reports/:reportId', deleteReport);

// ─── BOQ ──────────────────────────────────────────────────────────────────────
router.get('/sites/:siteId/boq',            listBOQ);
router.post('/sites/:siteId/boq',           addBOQItem);
router.put('/sites/:siteId/boq/:itemId',    updateBOQItem);
router.delete('/sites/:siteId/boq/:itemId', deleteBOQItem);

// ─── Equipment ────────────────────────────────────────────────────────────────
router.get('/sites/:siteId/equipment',              listEquipment);
router.post('/sites/:siteId/equipment',             addEquipment);
router.put('/sites/:siteId/equipment/:equipId',     updateEquipment);
router.delete('/sites/:siteId/equipment/:equipId',  deleteEquipment);

// ─── Expenses ─────────────────────────────────────────────────────────────────
router.get('/sites/:siteId/expenses',                listExpenses);
router.post('/sites/:siteId/expenses',               addExpense);
router.delete('/sites/:siteId/expenses/:expenseId',  deleteExpense);

// ─── Invoices ─────────────────────────────────────────────────────────────────
router.get('/sites/:siteId/invoices',               listInvoices);
router.post('/sites/:siteId/invoices',              createInvoice);
router.put('/sites/:siteId/invoices/:invoiceId',    updateInvoice);
router.delete('/sites/:siteId/invoices/:invoiceId', deleteInvoice);

// ─── Subcontractors ───────────────────────────────────────────────────────────
router.get('/sites/:siteId/subcontractors',           listSubcontractors);
router.post('/sites/:siteId/subcontractors',          addSubcontractor);
router.put('/sites/:siteId/subcontractors/:subId',    updateSubcontractor);
router.delete('/sites/:siteId/subcontractors/:subId', deleteSubcontractor);

export default router;
