import axios from "axios";
import FormData from "form-data";

const API_VERSION = process.env.WHATSAPP_API_VERSION || "v20.0";
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

console.log("SERVICE FILE — PHONE_NUMBER_ID:", PHONE_NUMBER_ID);
console.log("SERVICE FILE — ACCESS_TOKEN exists:", !!ACCESS_TOKEN);

const BASE_URL = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}`;

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
  });
  return res.data.id;
}

// Step 2: send a document message referencing that media id.
// `to` must be in international format without "+" e.g. "919500950813"
export async function sendInvoiceWhatsApp({ to, invoiceNumber, pdfBuffer }) {
  console.log("🚀 sendInvoiceWhatsApp called with to:", to);
  
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    throw new Error("WhatsApp is not configured...");
  }

  const filename = `Invoice-${invoiceNumber}.pdf`;
  console.log("📤 Uploading media:", filename);
  
  const mediaId = await uploadMedia(pdfBuffer, filename);
  console.log("✅ Media uploaded, ID:", mediaId);

  console.log("📨 Sending message to:", to, "with mediaId:", mediaId);
  
  await axios.post(
    `${BASE_URL}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: {
        id: mediaId,
        filename,
        caption: `Invoice ${invoiceNumber}`,
      },
    },
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
  
  console.log("✅ Message sent successfully");
}

// Fallback that needs no API setup: builds a wa.me link with a prefilled message.
// Useful while the Cloud API isn't configured yet - admin clicks it and sends manually
// (the PDF itself would need to be attached by hand, or hosted and linked in the message).
export function buildWhatsAppShareLink({ to, invoiceNumber, pdfUrl }) {
  const text = encodeURIComponent(
    `Hi, please find your invoice ${invoiceNumber} from ${process.env.COMPANY_NAME}.${
      pdfUrl ? ` Download: ${pdfUrl}` : ""
    }`
  );
  return `https://wa.me/${to}?text=${text}`;
}
  