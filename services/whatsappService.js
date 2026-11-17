import axios from "axios";
import FormData from "form-data";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v20.0";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

const BASE_URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}`;
const REQUEST_TIMEOUT_MS = 20000;

const safeFilename = (prefix, number) =>
  `${prefix}-${String(number || "document").replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;

// Step 1: upload the PDF buffer to WhatsApp's media endpoint, get a media id back.
async function uploadMedia(pdfBuffer, filename) {
  const form = new FormData();
  form.append("file", pdfBuffer, { filename, contentType: "application/pdf" });
  form.append("messaging_product", "whatsapp");

  const res = await axios.post(`${BASE_URL}/media`, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 0,
    maxBodyLength: 10 * 1024 * 1024,
  });
  return res.data.id;
}

// Step 2: send a document message referencing that media id.
async function sendDocumentWhatsApp({ to, filename, caption, pdfBuffer }) {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    throw new Error("WhatsApp is not configured (phone number id or access token missing)");
  }

  const mediaId = await uploadMedia(pdfBuffer, filename);

  await axios.post(
    `${BASE_URL}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption,
      },
    },
    {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      timeout: REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
    }
  );
}

export async function sendInvoiceWhatsApp({ to, invoiceNumber, pdfBuffer }) {
  await sendDocumentWhatsApp({
    to,
    filename: safeFilename("Invoice", invoiceNumber),
    caption: `Invoice ${invoiceNumber}`,
    pdfBuffer,
  });
}

export async function sendQuotationWhatsApp({ to, quotationNumber, pdfBuffer }) {
  await sendDocumentWhatsApp({
    to,
    filename: safeFilename("Quotation", quotationNumber),
    caption: `Quotation ${quotationNumber}`,
    pdfBuffer,
  });
}

// Fallback that needs no API setup: builds a wa.me link with a prefilled message.
export function buildWhatsAppShareLink({ to, invoiceNumber, pdfUrl, companyName }) {
  const compName = companyName || process.env.COMPANY_NAME || "FlareMinds";
  const text = encodeURIComponent(
    `Hi, please find your invoice ${invoiceNumber} from ${compName}.${
      pdfUrl ? ` Download: ${pdfUrl}` : ""
    }`
  );
  return `https://wa.me/${to}?text=${text}`;
}

export function buildQuotationShareLink({ to, quotationNumber, pdfUrl, companyName }) {
  const compName = companyName || process.env.COMPANY_NAME || "FlareMinds";
  const text = encodeURIComponent(
    `Hi, please find your quotation ${quotationNumber} from ${compName}.${
      pdfUrl ? ` Download: ${pdfUrl}` : ""
    }`
  );
  return `https://wa.me/${to}?text=${text}`;
}
