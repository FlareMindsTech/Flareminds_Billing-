import express from "express";
import {
  listAllCompanies,
  createCompanyWithAdmin,
  updateCompanyStatus,
  setDefaultCompanyAdmin,
  resetCompanyAdminPassword,
  deleteCompanyPermanently,
  getPlatformOverview,
} from "../controllers/adminCompanyController.js";
import { getTemplatePresets } from "../controllers/templateController.js";
import {
  listSystemTemplates,
  getTemplateCatalog,
  getSystemTemplate,
  createSystemTemplate,
  updateSystemTemplate,
  cloneSystemTemplate,
  deleteSystemTemplate,
  previewSystemTemplate,
  assignTemplate,
  listAssignments,
  unassignTemplate,
  getSystemTemplateLimits,
} from "../controllers/adminTemplateController.js";

const router = express.Router();

router.get("/overview", getPlatformOverview);
router.get("/companies", listAllCompanies);
router.post("/companies", createCompanyWithAdmin);
router.patch("/companies/:id/status", updateCompanyStatus);
router.post("/companies/:id/default", setDefaultCompanyAdmin);
router.patch("/companies/:id/admin/password", resetCompanyAdminPassword);
router.delete("/companies/:id", deleteCompanyPermanently);
router.get("/template-presets", getTemplatePresets);

router.get("/templates/catalog", getTemplateCatalog);
router.get("/templates/limits", getSystemTemplateLimits);
router.get("/templates", listSystemTemplates);
router.post("/templates", createSystemTemplate);
router.post("/templates/preview", previewSystemTemplate);
router.get("/templates/:id", getSystemTemplate);
router.put("/templates/:id", updateSystemTemplate);
router.post("/templates/:id/clone", cloneSystemTemplate);
router.delete("/templates/:id", deleteSystemTemplate);
router.post("/templates/:id/preview", previewSystemTemplate);
router.post("/templates/:id/assign", assignTemplate);
router.get("/templates/:id/assignments", listAssignments);
router.delete("/templates/:id/assignments", unassignTemplate);

export default router;
