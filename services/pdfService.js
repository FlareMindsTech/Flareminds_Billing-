import puppeteer from "puppeteer";
import { renderInvoiceHTML } from "../templates/invoiceTemplate.js";

const getCompanyAndBank = () => ({
  company: {
    name: process.env.COMPANY_NAME || "FlareMinds Technology and Services",
    gstn: process.env.COMPANY_GSTN || "",
    phone: process.env.COMPANY_PHONE || "",
    email: process.env.COMPANY_EMAIL || "",
    website: process.env.COMPANY_WEBSITE || "",
  },

  bank: {
    accNo: process.env.BANK_ACC_NO || "",
    name: process.env.BANK_NAME || "",
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

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 1,
    });

    await page.setContent(html, {
      waitUntil: "networkidle0",
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,

      margin: {
        top: "0mm",
        right: "0mm",
        bottom: "0mm",
        left: "0mm",
      },

      preferCSSPageSize: true,
    });

    return pdfBuffer;

  } finally {
    await browser.close();
  }
}