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
  // Milestones
  listMilestones, addMilestone, updateMilestone, deleteMilestone,
  // Leads
  listLeads, addLead, updateLead, deleteLead,
  // Designs
  listDesigns, addDesign, updateDesign, deleteDesign,
  // Quality
  listQualityChecks, addQualityCheck, updateQualityCheck, deleteQualityCheck,
  // Procurement
  listProcurements, createProcurement, updateProcurement, deleteProcurement,
  // Vendor Bills
  listVendorBills, addVendorBill, updateVendorBill, deleteVendorBill,
  // Production
  listProductions, addProduction, updateProduction, deleteProduction,
  // P&L
  getPnL,
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

// ─── Milestones (Planning) ───────────────────────────────────────────────────
router.get('/sites/:siteId/milestones',          listMilestones);
router.post('/sites/:siteId/milestones',         addMilestone);
router.put('/sites/:siteId/milestones/:id',      updateMilestone);
router.delete('/sites/:siteId/milestones/:id',   deleteMilestone);

// ─── Leads (Sales) ───────────────────────────────────────────────────────────
router.get('/sites/:siteId/leads',         listLeads);
router.post('/sites/:siteId/leads',        addLead);
router.put('/sites/:siteId/leads/:id',     updateLead);
router.delete('/sites/:siteId/leads/:id',  deleteLead);

// ─── Designs ─────────────────────────────────────────────────────────────────
router.get('/sites/:siteId/designs',         listDesigns);
router.post('/sites/:siteId/designs',        addDesign);
router.put('/sites/:siteId/designs/:id',     updateDesign);
router.delete('/sites/:siteId/designs/:id',  deleteDesign);

// ─── Quality ─────────────────────────────────────────────────────────────────
router.get('/sites/:siteId/quality',         listQualityChecks);
router.post('/sites/:siteId/quality',        addQualityCheck);
router.put('/sites/:siteId/quality/:id',     updateQualityCheck);
router.delete('/sites/:siteId/quality/:id',  deleteQualityCheck);

// ─── Procurement ─────────────────────────────────────────────────────────────
router.get('/sites/:siteId/procurement',         listProcurements);
router.post('/sites/:siteId/procurement',        createProcurement);
router.put('/sites/:siteId/procurement/:id',     updateProcurement);
router.delete('/sites/:siteId/procurement/:id',  deleteProcurement);

// ─── Vendor Bills ─────────────────────────────────────────────────────────────
router.get('/sites/:siteId/vendor-bills',         listVendorBills);
router.post('/sites/:siteId/vendor-bills',        addVendorBill);
router.put('/sites/:siteId/vendor-bills/:id',     updateVendorBill);
router.delete('/sites/:siteId/vendor-bills/:id',  deleteVendorBill);

// ─── Production Tasks ────────────────────────────────────────────────────────
router.get('/sites/:siteId/production',         listProductions);
router.post('/sites/:siteId/production',        addProduction);
router.put('/sites/:siteId/production/:id',     updateProduction);
router.delete('/sites/:siteId/production/:id',  deleteProduction);

// ─── P&L ─────────────────────────────────────────────────────────────────────
router.get('/sites/:siteId/pnl', getPnL);

export default router;
