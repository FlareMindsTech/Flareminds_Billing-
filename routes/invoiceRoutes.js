import express from "express";
import rateLimit from "express-rate-limit";
import {
  listInvoices,
  getInvoice,
  createInvoice,
  updateInvoice,
  deleteInvoice,
  downloadInvoicePDF,
  emailInvoice,
  whatsappInvoice,
} from "../controllers/invoiceController.js";
import {
  listInvoicePayments,
  recordInvoicePayment,
  voidInvoicePayment,
} from "../controllers/paymentController.js";

const router = express.Router();

// PDF generation launches Chrome and outbound delivery calls third-party APIs,
// so they get their own per-IP budgets independent of the login limiter.
// Exported so quotation routes draw from the same shared budgets.
export const pdfLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many PDF requests. Please try again later." },
});

export const deliveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many delivery attempts. Please try again later." },
});

router.get("/", listInvoices);
router.get("/:id", getInvoice);
router.post("/", createInvoice);
router.put("/:id", updateInvoice);
router.delete("/:id", deleteInvoice);

router.get("/:id/pdf", pdfLimiter, downloadInvoicePDF);
router.post("/:id/send-email", deliveryLimiter, emailInvoice);
router.post("/:id/send-whatsapp", deliveryLimiter, whatsappInvoice);

router.get("/:id/payments", listInvoicePayments);
router.post("/:id/payments", recordInvoicePayment);
router.post("/:id/payments/:paymentId/void", voidInvoicePayment);

export default router;
