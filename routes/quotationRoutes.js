import express from "express";
import {
  listQuotations,
  getQuotation,
  createQuotation,
  updateQuotation,
  deleteQuotation,
  downloadQuotationPDF,
  emailQuotation,
  whatsappQuotation,
  acceptQuotation,
  rejectQuotation,
  convertQuotationToInvoice,
} from "../controllers/quotationController.js";
import { pdfLimiter, deliveryLimiter } from "./invoiceRoutes.js";

const router = express.Router();

router.get("/", listQuotations);
router.get("/:id", getQuotation);
router.post("/", createQuotation);
router.put("/:id", updateQuotation);
router.delete("/:id", deleteQuotation);

// PDF generation and outbound delivery share the invoice limiter instances so
// both document types draw from the same anti-abuse budgets.
router.get("/:id/pdf", pdfLimiter, downloadQuotationPDF);
router.post("/:id/send-email", deliveryLimiter, emailQuotation);
router.post("/:id/send-whatsapp", deliveryLimiter, whatsappQuotation);

// Lifecycle transitions
router.post("/:id/accept", acceptQuotation);
router.post("/:id/reject", rejectQuotation);
router.post("/:id/convert-to-invoice", convertQuotationToInvoice);

export default router;
