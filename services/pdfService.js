import puppeteerCore from "puppeteer-core";
import { renderInvoiceHTML } from "../templates/invoiceTemplate.js";
import { renderQuotationHTML, escapeHtml } from "../templates/quotationTemplate.js";
import { renderDynamicDocumentHTML, shouldUseExternalFooter } from "../templates/dynamicRenderer.js";

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

function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;

  if (process.platform === "win32") {
    return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  }

  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  return "/usr/bin/google-chrome";
}

const launchOptions = {
  executablePath: resolveChromePath(),
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--font-render-hinting=none",
    "--enable-font-antialiasing",
  ],
};

// Reuse a single browser process across PDF requests; launching Chrome per
// invoice is slow and memory-hungry.
let browserPromise = null;

// Closes the shared browser. Used by graceful shutdown and tests so the
// Chrome child process cannot keep the Node event loop alive.
export async function closePdfBrowser() {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // Already closed/crashed - nothing to release.
  }
}

function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteerCore
      .launch(launchOptions)
      .then((browser) => {
        browser.once("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }

  return browserPromise;
}

// Shared render flow: one Chrome page, A4, print backgrounds, CSS page size.
// `footerHtml` opts in to Chrome's repeating page footer (margins are then
// reserved at the bottom and the page's own static footer sits above it);
// invoices keep the marginless layout they have always used.
export async function renderHtmlToPdf(html, { footerHtml } = {}) {
  let browser = await getBrowser();
  let page;

  try {
    page = await browser.newPage();
  } catch (err) {
    // The cached browser may have died; drop it and try once more.
    browserPromise = null;
    browser = await getBrowser();
    page = await browser.newPage();
  }

  try {
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });

    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.evaluateHandle(() => document.fonts.ready);

    const rawPdf = await page.pdf(
      footerHtml
        ? {
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: "<div></div>",
            footerTemplate: footerHtml,
            margin: { top: "0mm", right: "0mm", bottom: "12mm", left: "0mm" },
          }
        : {
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
          }
    );

    return Buffer.isBuffer(rawPdf) ? rawPdf : Buffer.from(rawPdf);
  } finally {
    await page.close().catch(() => {});
  }
}

function pageFooterHtml(company) {
  return `
    <div style="width:100%; padding:0 14mm; font-family: Arial, sans-serif; font-size:8px; color:#64748b; display:flex; justify-content:space-between; align-items:flex-end;">
      <span>${escapeHtml(company.name || "")}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`;
}

export async function generateInvoicePDF(
  invoice,
  client,
  customCompany = null,
  template = null
) {
  const { company: defaultCompany, bank: defaultBank } = getCompanyAndBank();
  const company = customCompany || defaultCompany;

  if (template) {
    const html = renderDynamicDocumentHTML({
      docType: "invoice",
      doc: invoice,
      client,
      company,
      template,
    });
    const footerHtml =
      template.layout?.showPageNumbers === false || !shouldUseExternalFooter(template)
        ? undefined
        : pageFooterHtml(company);
    return renderHtmlToPdf(html, { footerHtml });
  }

  const bank = customCompany?.bank?.accountNumber ? customCompany.bank : defaultBank;
  const html = renderInvoiceHTML({ invoice, client, company, bank, template });
  return renderHtmlToPdf(html);
}

// Quotations reuse the browser infrastructure but never the invoice template.
export async function generateQuotationPDF(
  quotation,
  client = {},
  customCompany = null,
  template = null
) {
  const { company: defaultCompany } = getCompanyAndBank();
  const company = customCompany || defaultCompany;

  if (template) {
    const html = renderDynamicDocumentHTML({
      docType: "quotation",
      doc: quotation,
      client: client || {},
      company,
      template,
    });
    const footerHtml =
      template.layout?.showPageNumbers === false || !shouldUseExternalFooter(template)
        ? undefined
        : pageFooterHtml(company);
    return renderHtmlToPdf(html, { footerHtml });
  }

  const html = renderQuotationHTML({
    quotation,
    client: client || {},
    company,
  });

  // Repeating "Page X of Y" footer rendered by Chrome into the reserved
  // 12mm bottom page margin (in addition to the in-body company footer).
  const footerHtml = pageFooterHtml(company);

  return renderHtmlToPdf(html, { footerHtml });
}
