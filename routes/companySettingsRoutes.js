import express from "express";
import { getMyCompany, updateMyCompany, uploadCompanyLogoHandler } from "../controllers/companyController.js";

const router = express.Router();

router.get("/", getMyCompany);
router.put("/", updateMyCompany);
router.post("/logo", uploadCompanyLogoHandler);

export default router;
