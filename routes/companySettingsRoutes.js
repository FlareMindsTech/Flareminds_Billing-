import express from "express";
import { getMyCompany, updateMyCompany } from "../controllers/companyController.js";

const router = express.Router();

router.get("/", getMyCompany);
router.put("/", updateMyCompany);

export default router;
