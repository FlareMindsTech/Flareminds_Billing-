import express from "express";
import rateLimit from "express-rate-limit";
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  setDefaultTemplate,
  cloneTemplate,
  getTemplatePresets,
  previewTemplate,
} from "../controllers/templateController.js";

const router = express.Router();

const previewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many preview requests. Please try again later." },
});

// Static paths must be registered before /:id.
router.get("/presets", getTemplatePresets);
router.post("/preview", previewLimiter, previewTemplate);

router.get("/", listTemplates);
router.post("/", createTemplate);
router.get("/:id", getTemplate);
router.put("/:id", updateTemplate);
router.delete("/:id", deleteTemplate);
router.post("/:id/default", setDefaultTemplate);
router.post("/:id/clone", cloneTemplate);

export default router;
