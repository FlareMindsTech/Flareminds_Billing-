import express from "express";
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

const router = express.Router();

router.get("/", listInvoices);
router.get("/:id", getInvoice);
router.post("/", createInvoice);
router.put("/:id", updateInvoice);
router.delete("/:id", deleteInvoice);

router.get("/:id/pdf", downloadInvoicePDF);
router.post("/:id/send-email", emailInvoice);
router.post("/:id/send-whatsapp", whatsappInvoice);

export default router;
