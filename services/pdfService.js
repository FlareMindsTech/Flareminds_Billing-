import pdf from "html-pdf";
import { renderInvoiceHTML } from "../templates/invoiceTemplate.js";

const getCompanyAndBank = () => ({
  company: {
    name: process.env.COMPANY_NAME || "FlareMinds Technology and Services",
    gstin: process.env.COMPANY_GSTIN || "",
    phone: process.env.COMPANY_PHONE || "",
    email: process.env.COMPANY_EMAIL || "",
    website: process.env.COMPANY_WEBSITE || "",
  },

  bank: {
    accountNumber: process.env.BANK_ACC_NO || "",
    accountName: process.env.BANK_NAME || "",
    ifsc: process.env.BANK_IFSC || "",
    branch: process.env.BANK_BRANCH || "",
    upi: process.env.BANK_UPI || "",
  },
});

export async function generateInvoicePDF(invoice, client) {
  const { company, bank } = getCompanyAndBank();

  const html = renderInvoiceHTML({
    invoice,
    client,
    company,
    bank,
  });

  const pdfOptions = {
    format: "A4",
    orientation: "portrait",
    border: "0mm",
    type: "buffer",
    quality: 100,
  };

  return new Promise((resolve, reject) => {
    pdf.create(html, pdfOptions).toBuffer((err, buffer) => {
      if (err) reject(err);
      else resolve(buffer);
    });
  });
}