import Invoice from "../models/Invoice.js";
import Client from "../models/Client.js";
import Counter from "../models/Counter.js";
import { generateInvoicePDF } from "../services/pdfService.js";
import { sendInvoiceEmail } from "../services/emailService.js";
import { sendInvoiceWhatsApp, buildWhatsAppShareLink } from "../services/whatsappService.js";

// Generates the next invoice number for the current year, e.g. FM-2026-0003
// Uses atomic increment to prevent race conditions
async function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const counterKey = `invoiceNumber_${year}`;

  let isUnique = false;
  let finalInvoiceNumber = "";

  while (!isUnique) {
    // 1. Atomic increment counter
    const counter = await Counter.findByIdAndUpdate(
      counterKey,
      { $inc: { sequence: 1 } },
      { new: true, upsert: true }
    );

    const candidateNumber = `FM-${year}-${String(counter.sequence).padStart(4, "0")}`;

    // 2. Double-check that this invoice number doesn't already exist in DB
    const existing = await Invoice.findOne({ invoiceNumber: candidateNumber });
    if (!existing) {
      finalInvoiceNumber = candidateNumber;
      isUnique = true;
    }
  }

  return finalInvoiceNumber;
}

// Recomputes amount per line item and the invoice totals server-side,
// so the frontend can't send a tampered grand total.
function computeTotals(lineItems, taxPercent = 0) {
  const items = lineItems.map((item) => ({
    ...item,
    amount: Number(item.quantity || 1) * Number(item.rate),
  }));
  const subTotal = items.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = (subTotal * Number(taxPercent || 0)) / 100;
  const grandTotal = subTotal + taxAmount;
  return { items, subTotal, taxAmount, grandTotal };
}

export const listInvoices = async (req, res) => {
  const { status, client } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (client) filter.client = client;

  const invoices = await Invoice.find(filter).populate("client").sort({ createdAt: -1 });
  res.json(invoices);
};

export const getInvoice = async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate("client");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  res.json(invoice);
};

export const createInvoice = async (req, res) => {
  try {
    const { client, lineItems, taxPercent, date, dueDate, notes } = req.body;

    // Validation: Client exists
    const clientDoc = await Client.findById(client);
    if (!clientDoc) return res.status(400).json({ message: "Client not found" });

    // Validation: Line items
    if (!lineItems || lineItems.length === 0) {
      return res.status(400).json({ message: "Invoice must have at least one line item" });
    }

    // Convert string dates to Date objects
    const invoiceDate = new Date(date);
    const invoiceDueDate = dueDate ? new Date(dueDate) : null;

    // Validation: dueDate must be after invoice date
    if (invoiceDueDate && invoiceDueDate <= invoiceDate) {
      return res.status(400).json({ message: "Due date must be after invoice date" });
    }

    const { items, subTotal, taxAmount, grandTotal } = computeTotals(lineItems, taxPercent);
    const invoiceNumber = await nextInvoiceNumber();

    const invoice = await Invoice.create({
      invoiceNumber,
      client,
      date: invoiceDate,
      dueDate: invoiceDueDate,
      lineItems: items,
      subTotal,
      taxPercent: taxPercent || 0,
      taxAmount,
      grandTotal,
      notes,
    });

    res.status(201).json(invoice);
  } catch (err) {
    console.error("Create invoice error:", err);
    res.status(500).json({ message: "Failed to create invoice", error: err.message });
  }
};

export const updateInvoice = async (req, res) => {
  try {
    const { lineItems, taxPercent, date, dueDate } = req.body;
    const update = { ...req.body };

    // Convert dates if provided
    if (date) update.date = new Date(date);
    if (dueDate) update.dueDate = new Date(dueDate);

    // Validation: dueDate must be after invoice date
    if (update.date && update.dueDate && update.dueDate <= update.date) {
      return res.status(400).json({ message: "Due date must be after invoice date" });
    }

    if (lineItems) {
      const { items, subTotal, taxAmount, grandTotal } = computeTotals(lineItems, taxPercent);
      Object.assign(update, { lineItems: items, subTotal, taxAmount, grandTotal });
    }

    const invoice = await Invoice.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    }).populate("client");

    if (!invoice) return res.status(404).json({ message: "Invoice not found" });
    res.json(invoice);
  } catch (err) {
    console.error("Update invoice error:", err);
    res.status(500).json({ message: "Failed to update invoice", error: err.message });
  }
};

export const deleteInvoice = async (req, res) => {
  const invoice = await Invoice.findByIdAndDelete(req.params.id);
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });
  res.json({ message: "Invoice deleted" });
};

// Streams the invoice as a downloadable/viewable PDF.
export const downloadInvoicePDF = async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate("client");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const pdfBuffer = await generateInvoicePDF(invoice, invoice.client);

  res.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename="Invoice-${invoice.invoiceNumber}.pdf"`,
  });
  res.send(pdfBuffer);
};

// Emails the PDF to the client (or an address passed in the body).
export const emailInvoice = async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate("client");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const to = req.body.to || invoice.client.email;
  if (!to) return res.status(400).json({ message: "No email address on file for this client" });

  const pdfBuffer = await generateInvoicePDF(invoice, invoice.client);

  try {
    await sendInvoiceEmail({
      to,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.client.name,
      pdfBuffer,
    });
    invoice.sentLog.push({ channel: "email", to, success: true });
    if (invoice.status === "draft") invoice.status = "sent";
    await invoice.save();
    res.json({ message: "Invoice emailed", to });
  } catch (err) {
    invoice.sentLog.push({ channel: "email", to, success: false, error: err.message });
    await invoice.save();
    res.status(502).json({ message: "Failed to send email", error: err.message });
  }
};

// Sends the PDF over WhatsApp via the Cloud API (falls back to a wa.me share link
// in the response if the Cloud API isn't configured, so the admin can still send manually).
export const whatsappInvoice = async (req, res) => {
  console.log("🔔 whatsappInvoice endpoint called with invoiceId:", req.params.id);
  
  const invoice = await Invoice.findById(req.params.id).populate("client");
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  let to = (req.body.to || invoice.client.whatsapp || "").replace(/\D/g, "");
  console.log("📱 Raw WhatsApp number:", invoice.client.whatsapp);
  console.log("📱 After removing non-digits:", to);

  if (to && !to.startsWith("91")) {
    to = "91" + to;
  }
  console.log("📱 Final 'to' number:", to);

  const pdfBuffer = await generateInvoicePDF(invoice, invoice.client);
  console.log("📄 PDF generated, buffer size:", pdfBuffer.length);

  try {
    console.log("📤 Calling sendInvoiceWhatsApp with:", { to, invoiceNumber: invoice.invoiceNumber });
    await sendInvoiceWhatsApp({ to, invoiceNumber: invoice.invoiceNumber, pdfBuffer });
    
    invoice.sentLog.push({ channel: "whatsapp", to, success: true });
    if (invoice.status === "draft") invoice.status = "sent";
    await invoice.save();
    res.json({ message: "Invoice sent on WhatsApp", to });
  } catch (err) {
    console.error("❌ WhatsApp send error:", err.response?.data || err.message);
    invoice.sentLog.push({ channel: "whatsapp", to, success: false, error: err.message });
    await invoice.save();
    const shareLink = buildWhatsAppShareLink({ to, invoiceNumber: invoice.invoiceNumber });
    res.status(502).json({
      message: "WhatsApp Cloud API send failed",
      error: err.response?.data?.error?.message || err.message,
      shareLink,
    });
  }
};