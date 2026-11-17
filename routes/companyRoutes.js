import express from "express";
import {
  listCompanies,
  getCurrentCompany,
  getCompany,
  createCompany,
  updateCompany,
  setDefaultCompany,
  deleteCompany,
} from "../controllers/companyController.js";
import { requireSuperadmin } from "../middleware/role.js";
import { resolveCompany } from "../middleware/company.js";

const router = express.Router();

// Read endpoints are scoped to the caller's company.
router.get("/", listCompanies);
router.get("/current", resolveCompany, getCurrentCompany);
router.get("/:id", getCompany);

// Legacy company lifecycle endpoints are superadmin-only. The UI uses
// /admin/companies, but these stay for backwards compatibility.
router.post("/", requireSuperadmin, createCompany);
router.put("/:id", requireSuperadmin, updateCompany);
router.post("/:id/default", requireSuperadmin, setDefaultCompany);
router.delete("/:id", requireSuperadmin, deleteCompany);

export default router;
