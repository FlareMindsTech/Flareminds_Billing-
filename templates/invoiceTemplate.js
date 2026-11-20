import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { invoicePaymentState } from "../utils/invoicePayments.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IMAGES_DIR = path.join(__dirname, "..", "images");
const FONTS_DIR = path.join(__dirname, "..", "fonts");
const DEFAULT_LOGO_ICON_PATH = path.join(IMAGES_DIR, "fm logo.png");
const DEFAULT_LOGO_TEXT_PATH = path.join(IMAGES_DIR, "fm flareminds.png");

const toDataUri = (filePath) => {
  try {
    const resolved = path.resolve(filePath);
    const buffer = fs.readFileSync(resolved);
    const ext = path.extname(resolved).slice(1).toLowerCase();
    const mime = ext === "jpg" ? "jpeg" : ext || "png";
    return `data:image/${mime};base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.warn(`[invoiceTemplate] Could not read logo file: ${filePath}`);
    return null;
  }
};

const resolveLogoSrc = (value) => {
  if (!value) return null;
  if (value.startsWith("data:") || /^https?:\/\//i.test(value)) {
    return value;
  }
  return toDataUri(value);
};

const fontToBase64 = (filename) => {
  try {
    const filePath = path.join(FONTS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      console.warn(
        `[invoiceTemplate] Font file missing at path: ${filePath}`
      );
      return "";
    }

    const buffer = fs.readFileSync(filePath);
    return buffer.toString("base64");
  } catch (err) {
    console.warn(
      `[invoiceTemplate] Error reading font ${filename}:`,
      err
    );
    return "";
  }
};

const robotoRegular = fontToBase64("Roboto-Regular.ttf");
const robotoBold = fontToBase64("Roboto-Bold.ttf");

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatDate = (date) => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-GB");
};

const money = (value) =>
  `₹ ${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const icons = {
  globe: `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  phone: `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>`,
  mail: `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>`,
  bank: `<path d="M3 21h18M3 10h18M5 10v11M9 10v11M15 10v11M19 10v11M12 3L2 10h20L12 3z"/>`,
  user: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  shield: `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`,
  pin: `<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`,
  wallet: `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M16 12h.01"/>`,
};

const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || ""}</svg>`;

const socialIcons = {
  facebook: `
    <path
      d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"
    />
  `,

  instagram: `
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
  `,

  linkedin: `
    <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
    <rect x="2" y="9" width="4" height="12" />
    <circle cx="4" cy="4" r="2" />
  `,

  youtube: `
    <rect x="2" y="5" width="20" height="14" rx="4" ry="4" />
    <polygon points="10,9 16,12 10,15" fill="none" />
  `,
};

const socialIcon = (name) =>
  `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    ${socialIcons[name] || ""}
  </svg>`;

export function renderInvoiceHTML({
  invoice,
  client = {},
  company = {},
  bank: bankParam = {},
  template = null,
}) {
  const items = invoice.items || invoice.lineItems || [];

  const subtotal =
    invoice.subtotal ??
    invoice.subTotal ??
    items.reduce((sum, item) => {
      const qty = Number(item.quantity || 1);
      const unitPrice = Number(
        item.unitPrice ??
          item.price ??
          item.rate ??
          0
      );

      return (
        sum +
        Number(
          item.amount ??
            item.total ??
            unitPrice * qty
        )
      );
    }, 0);

  const tax = Number(
    invoice.tax ??
      invoice.taxAmount ??
      0
  );

  const taxRate =
    invoice.taxRate ??
    invoice.taxPercent ??
    (subtotal > 0
      ? Math.round((tax / subtotal) * 100)
      : 0);

  const hasMixedTaxRates =
    items.length > 0 &&
    new Set(items.map((item) => Number(item.taxPercent ?? taxRate))).size > 1;

  const total = Number(
    invoice.total ??
      invoice.grandTotal ??
      subtotal + tax
  );

  const paymentState = invoicePaymentState(invoice);
  const showPaymentSummary = template?.content?.showPaymentSummary !== false;

  const bank = {
    accountNumber:
      bankParam?.accountNumber ||
      bankParam?.accNo ||
      company.bank?.accountNumber ||
      company.bank?.accNo ||
      process.env.BANK_ACC_NO ||
      "",
    accountName:
      bankParam?.accountName ||
      bankParam?.name ||
      company.bank?.accountName ||
      company.bank?.name ||
      process.env.BANK_NAME ||
      "",
    ifsc:
      bankParam?.ifsc ||
      company.bank?.ifsc ||
      process.env.BANK_IFSC ||
      "",
    branch:
      bankParam?.branch ||
      company.bank?.branch ||
      process.env.BANK_BRANCH ||
      "",
    upi:
      bankParam?.upi ||
      company.bank?.upi ||
      process.env.BANK_UPI ||
      "",
  };

  const customLabels = company.customLabels || {};
  const invoiceTitle = customLabels.invoiceTitle || "INVOICE";
  const clientSectionTitle = customLabels.clientSectionTitle || "BILL TO";

  const docDefMap = new Map();
  for (const def of company.customFields || []) {
    if (def.key) docDefMap.set(def.key, def.label || def.key);
  }

  const itemDefMap = new Map();
  for (const def of company.itemCustomFields || []) {
    if (def.key) itemDefMap.set(def.key, def.label || def.key);
  }

  const customFieldRows = Object.entries(invoice.customFields || {})
    .filter(([_, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `
      <tr>
        <td class="label">${escapeHtml(docDefMap.get(k) || k)}</td>
        <td class="colon">:</td>
        <td class="val">${escapeHtml(String(v))}</td>
      </tr>
    `)
    .join("");

  /*
   * =====================================================
   * CLIENT DATA
   *
   * Only data mapping changed here.
   * Existing PDF design remains unchanged.
   * =====================================================
   */

  const clientName =
    client.name ||
    client.company ||
    client.companyName ||
    "-";

  const clientPhone =
    client.phone ||
    client.phoneNumber ||
    client.mobile ||
    client.mobileNumber ||
    client.whatsapp ||
    "";

  const clientEmail =
    client.email ||
    client.emailAddress ||
    "";

  /*
   * Supports:
   * address
   * addressLine1
   * addressLine2
   * street
   * city
   * state
   * pincode
   * postalCode
   * zipCode
   */
  const clientAddress =
    client.address ||
    client.addressLine ||
    client.addressLine1 ||
    client.street ||
    [
      client.addressLine1,
      client.addressLine2,
      client.street,
      client.city,
      client.state,
      client.pincode ||
        client.postalCode ||
        client.zipCode,
    ]
      .filter(Boolean)
      .join(", ") ||
    "";

  /*
   * GST supports all common names.
   */
 const gstin =
  client.gstn ||
  "-";

  const logoIconSrc = resolveLogoSrc(
    company.logoIconUrl ||
      company.logoIconPath ||
      DEFAULT_LOGO_ICON_PATH
  );

  const logoTextSrc = resolveLogoSrc(
    company.logoTextUrl ||
      company.logoTextPath ||
      DEFAULT_LOGO_TEXT_PATH
  );

  const rows = items.length
    ? items
        .map((item, index) => {
          const quantity =
            Number(item.quantity) || 1;

          const unitPrice = Number(
            item.unitPrice ??
              item.price ??
              item.rate ??
              0
          );

          const amount = Number(
            item.amount ??
              item.total ??
              unitPrice * quantity
          );

          const name =
            item.name ||
            item.productName ||
            item.description ||
            "Item";

          const showSubDescription =
            item.description &&
            item.name;

          const itemCustomEntries = Object.entries(item.customFields || {}).filter(
            ([_, v]) => v !== undefined && v !== null && v !== ""
          );
          const itemCustomPills = itemCustomEntries.length
            ? `<div style="margin-top:1.5mm; display:flex; flex-wrap:wrap; gap:1.5mm;">
                ${itemCustomEntries
                  .map(
                    ([k, v]) =>
                      `<span style="display:inline-block; font-size:7px; color:#475569; background:#f1f5f9; padding:0.5mm 1.5mm; border-radius:1mm; border:1px solid #e2e8f0;"><strong style="color:#0f766e;">${escapeHtml(
                        itemDefMap.get(k) || k
                      )}:</strong> ${escapeHtml(String(v))}</span>`
                  )
                  .join("")}
              </div>`
            : "";

          return `
            <tr>
              <td class="col-num">${String(index + 1).padStart(2, "0")}</td>

              <td class="col-desc">
                <p class="item-name">${escapeHtml(name)}</p>

                ${
                  showSubDescription
                    ? `<p class="item-sub">${escapeHtml(
                        item.description
                      )}</p>`
                    : ""
                }
                ${itemCustomPills}
              </td>

              <td class="col-qty">${quantity}</td>

              <td class="col-rate">
                ${Number(unitPrice).toLocaleString(
                  "en-IN",
                  {
                    minimumFractionDigits: 2,
                  }
                )}
              </td>

              <td class="col-amount">
                ${Number(amount).toLocaleString(
                  "en-IN",
                  {
                    minimumFractionDigits: 2,
                  }
                )}
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="empty-row">No items added</td></tr>`;

  const logoBlock = logoIconSrc
    ? `<img src="${logoIconSrc}" alt="${escapeHtml(
        company.name || ""
      )}" class="logo-icon" />`
    : `<div class="logo-fallback"><span>${escapeHtml(
        (company.name || "FM")
          .split(" ")
          .map((w) => w[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()
      )}</span></div>`;

  const brandTextBlock = logoTextSrc
    ? `<img src="${logoTextSrc}" alt="${escapeHtml(
        company.name || ""
      )}" class="logo-text" />`
    : `<p class="company-name">${escapeHtml(
        company.name || "Company"
      )}</p>`;

  /*
   * Client contact details are added inside the
   * existing BILL TO block.
   */
  const clientContactDetails = `
    ${
      clientPhone
        ? `<div class="client-contact"><span>${escapeHtml(clientPhone)}</span></div>`
        : ""
    }

    ${
      clientEmail
        ? `<div class="client-contact"><span>${escapeHtml(clientEmail)}</span></div>`
        : ""
    }
  `;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />

<style>

${
  robotoRegular
    ? `@font-face {
        font-family: 'Roboto';
        src: url('data:font/ttf;charset=utf-8;base64,${robotoRegular}') format('truetype');
        font-weight: 400;
        font-style: normal;
      }`
    : ""
}

${
  robotoBold
    ? `@font-face {
        font-family: 'Roboto';
        src: url('data:font/ttf;charset=utf-8;base64,${robotoBold}') format('truetype');
        font-weight: 700;
        font-style: normal;
      }`
    : ""
}

* {
  box-sizing: border-box;
}

@page {
  size: A4;
  margin: 0;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 210mm;
  height: 100%;
}

body {
  font-family: 'Roboto',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Arial,
    sans-serif !important;

  color: #0f172a;
  background: #ffffff;

  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.invoice-page {
  width: 210mm;
  min-height: 297mm;
  background: #ffffff;
  position: relative;

  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

/* ===================== HEADER ===================== */

.header {
  position: relative;
  padding: 12mm 14mm 4mm;
  overflow: hidden;
}

.top-right-ribbon {
  position: absolute;
  top: 0;
  right: 0;
  width: 80mm;
  height: 35mm;
  pointer-events: none;
}

.top-right-ribbon .shape-light {
  position: absolute;
  top: 0;
  right: 0;
  width: 80mm;
  height: 35mm;
  background: #60a5fa;
  clip-path: polygon(40% 0, 100% 0, 100% 65%);
}

.top-right-ribbon .shape-dark {
  position: absolute;
  top: 0;
  right: 0;
  width: 80mm;
  height: 35mm;
  background: #0056b3;
  clip-path: polygon(50% 0, 100% 0, 100% 55%);
}

.header-top {
  position: relative;
  z-index: 2;

  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.brand-block {
  display: flex;
  align-items: center;
  gap: 4mm;
}

.logo-icon,
.logo-fallback {
  width: 18mm;
  height: 18mm;
  object-fit: contain;
  flex-shrink: 0;
}

.logo-fallback {
  border: 0.7mm solid #0056b3;
  border-radius: 50%;

  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-fallback span {
  font-size: 14px;
  font-weight: 900;
  color: #0056b3;
}

.brand-text {
  display: flex;
  flex-direction: column;
}

.logo-text {
  height: 10mm;
  max-width: 80mm;
  object-fit: contain;
  object-position: left center;
}

.company-name {
  font-size: 22px;
  font-weight: 800;
  color: #0056b3;
  margin: 0;
}

.company-tagline {
  font-size: 7px;
  font-weight: 700;
  color: #475569;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  margin: 1mm 0 0;
}

.invoice-title-block {
  text-align: right;
  margin-top: 4mm;
  margin-right: 15mm;
}

.invoice-title-block h1 {
  margin: 0;
  font-size: 34px;
  font-weight: 900;
  letter-spacing: 1px;
  color: #0a2540;
}

.invoice-title-block .underline {
  width: 45mm;
  height: 1.2mm;
  margin: 2mm 0 0 auto;
  background: #0056b3;
  border-radius: 2px;
}

/* ===================== BILL TO / INVOICE METADATA ===================== */

.meta-section {
  padding: 8mm 14mm 6mm;

  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.section-label {
  font-size: 10px;
  font-weight: 800;
  color: #0056b3;
  text-transform: uppercase;
  margin: 0 0 2mm;
}

.title-line {
  width: 12mm;
  height: 1mm;
  background: #0056b3;
  margin-bottom: 3mm;
}

.bill-to-block {
  max-width: 80mm;
}

.client-name {
  font-size: 11px;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 2mm;
}

.client-address {
  font-size: 9px;
  color: #475569;
  line-height: 1.5;
  margin: 0;
}

/*
 * NEW:
 * Client phone/email use the same existing
 * visual language and do not alter the layout.
 */
.client-contact {
  display: flex;
  align-items: center;
  gap: 1.5mm;
  font-size: 8.5px;
  color: #475569;
  line-height: 1.5;
  margin-top: 1.2mm;
}

.client-contact svg {
  width: 3.2mm;
  height: 3.2mm;
  color: #0056b3;
  flex-shrink: 0;
}

.invoice-details-table {
  border-collapse: collapse;
}

.invoice-details-table td {
  padding: 2mm 0;
  font-size: 9.5px;
}

.invoice-details-table .label {
  font-weight: 700;
  color: #0a2540;
  padding-right: 5mm;
}

.invoice-details-table .colon {
  padding-right: 5mm;
  font-weight: 700;
  color: #0a2540;
}

.invoice-details-table .val {
  font-weight: 600;
  color: #334155;
  text-align: left;
}

/* ===================== DYNAMIC FLEX MIDDLE BODY ===================== */

.content-body {
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

/* ===================== TABLE SECTION ===================== */

.table-section {
  padding: 6mm 14mm 0;
  flex-grow: 1;
}

.custom-table {
  width: 100%;
  border-collapse: collapse;
  border-radius: 2mm 2mm 0 0;
  overflow: hidden;
}

.custom-table thead tr {
  background: #0066cc;
}

.custom-table thead th {
  color: #ffffff;
  font-size: 8.5px;
  font-weight: 800;
  padding: 4mm 4mm;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.custom-table thead th.col-num {
  width: 10mm;
  text-align: center;
}

.custom-table thead th.col-desc {
  text-align: left;
}

.custom-table thead th.col-qty {
  width: 20mm;
  text-align: center;
}

.custom-table thead th.col-rate {
  width: 32mm;
  text-align: right;
}

.custom-table thead th.col-amount {
  width: 32mm;
  text-align: right;
}

.custom-table tbody td {
  padding: 4mm;
  border-bottom: 1px solid #e2e8f0;
  font-size: 9px;
  color: #334155;
}

.custom-table tbody tr:last-child td {
  border-bottom: 1px solid #cbd5e1;
}

.col-num {
  text-align: center;
  font-weight: 800;
  color: #0056b3;
}

.col-desc {
  text-align: left;
}

.item-name {
  margin: 0;
  font-weight: 600;
  color: #0f172a;
}

.item-sub {
  margin: 1.5mm 0 0;
  font-size: 8px;
  color: #64748b;
}

.col-qty {
  text-align: center;
}

.col-rate {
  text-align: right;
}

.col-amount {
  text-align: right;
  font-weight: 600;
}

.empty-row {
  text-align: center;
  padding: 10mm 6mm;
  color: #94a3b8;
}

/* ===================== TOTALS SECTION ===================== */

.totals-container {
  padding: 6mm 14mm 0;

  display: flex;
  justify-content: flex-end;
}

.totals-box {
  width: 82mm;
  background: #f0f7ff;
  border-radius: 1.5mm;
  overflow: hidden;
}

.totals-row {
  display: flex;
  justify-content: space-between;

  padding: 3mm 4mm;

  font-size: 9px;
  font-weight: 700;
  color: #0a2540;
}

.grand-total-row {
  background: #0056b3;
  color: #ffffff;

  padding: 3.5mm 4mm;

  display: flex;
  justify-content: space-between;
  align-items: center;
}

.grand-total-row .label {
  font-size: 9.5px;
  font-weight: 800;
  text-transform: uppercase;
}

.grand-total-row .val {
  font-size: 14px;
  font-weight: 900;
}

/* ===================== BOTTOM INFO SECTION ===================== */

.bottom-section {
  padding: 8mm 14mm 10mm;

  display: grid;
  grid-template-columns: 1fr 1fr;

  gap: 12mm;

  position: relative;
}

.bottom-section::before {
  content: "";

  position: absolute;
  top: 8mm;
  bottom: 10mm;
  left: 50%;

  width: 0.5px;

  background: #e2e8f0;
}

.payment-block,
.notes-block {
  display: flex;
  flex-direction: column;
}

.info-table {
  border-collapse: collapse;
  margin-top: 1.5mm;
}

.info-table td {
  padding: 2mm 0;
  font-size: 8.5px;
  vertical-align: middle;
}

.info-table .icon-cell {
  width: 6mm;
  color: #0056b3;
}

.info-table .icon-cell svg {
  width: 3.8mm;
  height: 3.8mm;
  display: block;
}

.info-table .label-cell {
  font-weight: 600;
  color: #334155;
  width: 18mm;
}

.info-table .colon-cell {
  width: 4mm;
  font-weight: 600;
  color: #334155;
}

.info-table .val-cell {
  font-weight: 600;
  color: #0f172a;
}

.notes-content p {
  font-size: 8.5px;
  color: #475569;
  line-height: 1.5;
  margin: 0 0 3.5mm;
}

/* ===================== FOOTER ===================== */

.footer {
  position: relative;

  padding: 5mm 14mm 5mm 30mm;

  background: #ffffff;
  border-top: 1px solid #f1f5f9;
}

.bottom-left-ribbon {
  position: absolute;
  bottom: 0;
  left: 0;

  width: 35mm;
  height: 25mm;

  pointer-events: none;
}

.bottom-left-ribbon .shape-light {
  position: absolute;
  bottom: 0;
  left: 0;

  width: 35mm;
  height: 25mm;

  background: #60a5fa;

  clip-path: polygon(
    0 40%,
    0 100%,
    75% 100%
  );
}

.bottom-left-ribbon .shape-dark {
  position: absolute;
  bottom: 0;
  left: 0;

  width: 35mm;
  height: 25mm;

  background: #0056b3;

  clip-path: polygon(
    0 50%,
    0 100%,
    65% 100%
  );
}

.footer-inner {
  display: flex;
  justify-content: space-between;
  align-items: center;

  font-size: 8px;
  font-weight: 600;
  color: #334155;
}

.footer-contact {
  display: flex;
  align-items: center;
  gap: 5mm;
}

.footer-item {
  display: flex;
  align-items: center;
  gap: 1.5mm;
}

.footer-item svg {
  width: 3.5mm;
  height: 3.5mm;
  color: #0056b3;
}

.footer-socials {
  display: flex;
  align-items: center;
  gap: 2.5mm;
}

.footer-socials svg {
  width: 4mm;
  height: 4mm;
  color: #0056b3;
}

</style>
</head>

<body>

<div class="invoice-page">

  <div>

    <!-- HEADER -->

    <div class="header">

      <div class="top-right-ribbon">
        <div class="shape-light"></div>
        <div class="shape-dark"></div>
      </div>

      <div class="header-top">

        <div class="brand-block">

          ${logoBlock}

          <div class="brand-text">

            ${brandTextBlock}

            ${
              company.tagline
                ? `<p class="company-tagline">${escapeHtml(
                    company.tagline
                  )}</p>`
                : ""
            }

          </div>

        </div>

        <div class="invoice-title-block">

          <h1>${escapeHtml(invoiceTitle)}</h1>

          <div class="underline"></div>

        </div>

      </div>

    </div>


    <!-- BILL TO & INVOICE DETAILS -->

    <div class="meta-section">

      <div class="bill-to-block">

        <div class="section-label">
          ${escapeHtml(clientSectionTitle)}
        </div>

        <div class="title-line"></div>

        <div class="client-name">
          ${escapeHtml(clientName)}
        </div>

        <div class="client-address">
          ${
            escapeHtml(
              clientAddress ||
                "123 Anywhere St.,\nAny City,\nST 12345"
            )
          .replace(/\n/g, "<br/>")}
        </div>

        ${clientContactDetails}

      </div>


      <div class="invoice-details-block">

        <table class="invoice-details-table">

          <tr>
            <td class="label">
              Invoice No.
            </td>

            <td class="colon">
              :
            </td>

            <td class="val">
              ${escapeHtml(
                invoice.invoiceNumber
              )}
            </td>
          </tr>


          <tr>
            <td class="label">
              Invoice Date
            </td>

            <td class="colon">
              :
            </td>

            <td class="val">
              ${formatDate(invoice.date)}
            </td>
          </tr>


          <tr>
            <td class="label">
              Due Date
            </td>

            <td class="colon">
              :
            </td>

            <td class="val">
              ${formatDate(
                invoice.dueDate ||
                  invoice.date
              )}
            </td>
          </tr>


          <tr>
            <td class="label">
              GSTIN
            </td>

            <td class="colon">
              :
            </td>

            <td class="val">
              ${escapeHtml(gstin)}
            </td>
          </tr>

          ${customFieldRows}

        </table>

      </div>

    </div>

  </div>


  <!-- DYNAMIC CONTENT AREA -->

  <div class="content-body">

    <!-- ITEMS TABLE -->

    <div class="table-section">

      <table class="custom-table">

        <thead>

          <tr>

            <th class="col-num">
              #
            </th>

            <th class="col-desc">
              DESCRIPTION
            </th>

            <th class="col-qty">
              QTY
            </th>

            <th class="col-rate">
              UNIT PRICE (₹)
            </th>

            <th class="col-amount">
              AMOUNT (₹)
            </th>

          </tr>

        </thead>

        <tbody>

          ${rows}

        </tbody>

      </table>

    </div>


    <div>

      <!-- TOTALS -->

      <div class="totals-container">

        <div class="totals-box">

          <div class="totals-row">

            <span>
              SUB TOTAL
            </span>

            <span>
              ${money(subtotal)}
            </span>

          </div>


          <div class="totals-row">

            <span>
              ${hasMixedTaxRates ? "TAX" : `TAX (${taxRate}%)`}
            </span>

           <span>
  ${money(tax).replace(/^₹\s*/, "")}
</span>

          </div>


          <div class="grand-total-row">

            <span class="label">
              GRAND TOTAL
            </span>

            <span class="val">
              ${money(total)}
            </span>

          </div>

          ${
            showPaymentSummary
              ? `
          <div class="totals-row">
            <span>PAID</span>
            <span>${money(paymentState.amountPaid)}</span>
          </div>

          <div class="totals-row">
            <span>BALANCE DUE</span>
            <span>${money(paymentState.balanceDue)}</span>
          </div>
          `
              : ""
          }

        </div>

      </div>


      <!-- PAYMENT DETAILS & NOTES -->

      <div class="bottom-section">

        <div class="payment-block">

          <div class="section-label">
            PAYMENT DETAILS
          </div>

          <div class="title-line"></div>

          <table class="info-table">

            <tr>

              <td class="icon-cell">
                ${icon("bank")}
              </td>

              <td class="label-cell">
                Acc No.
              </td>

              <td class="colon-cell">
                :
              </td>

              <td class="val-cell">
                ${escapeHtml(
                  bank.accountNumber || "-"
                )}
              </td>

            </tr>


            <tr>

              <td class="icon-cell">
                ${icon("user")}
              </td>

              <td class="label-cell">
                Name
              </td>

              <td class="colon-cell">
                :
              </td>

              <td class="val-cell">
                ${escapeHtml(
                  bank.accountName ||
                    bank.name ||
                    "-"
                )}
              </td>

            </tr>


            <tr>

              <td class="icon-cell">
                ${icon("shield")}
              </td>

              <td class="label-cell">
                IFSC
              </td>

              <td class="colon-cell">
                :
              </td>

              <td class="val-cell">
                ${escapeHtml(
                  bank.ifsc || "-"
                )}
              </td>

            </tr>


            <tr>

              <td class="icon-cell">
                ${icon("pin")}
              </td>

              <td class="label-cell">
                Branch
              </td>

              <td class="colon-cell">
                :
              </td>

              <td class="val-cell">
                ${escapeHtml(
                  bank.branch || "-"
                )}
              </td>

            </tr>


            <tr>

              <td class="icon-cell">
                ${icon("wallet")}
              </td>

              <td class="label-cell">
                UPI ID
              </td>

              <td class="colon-cell">
                :
              </td>

              <td class="val-cell">
                ${escapeHtml(
                  bank.upi || "-"
                )}
              </td>

            </tr>

          </table>

        </div>


        <div class="notes-block">

          <div class="section-label">
            NOTES
          </div>

          <div class="title-line"></div>

          <div class="notes-content">

            <p>
              ${escapeHtml(
                invoice.notes ||
                  "Thank you!"
              )}
            </p>

          </div>


          <div
            class="section-label"
            style="margin-top: 3mm;"
          >
            TERMS &amp; CONDITIONS
          </div>

          <div class="title-line"></div>

          <div class="notes-content">

            <p>
              ${escapeHtml(
                invoice.terms ||
                  "Payment is due within 15 days.\nPlease make checks payable to:\nFlareMinds Technology and Services"
              ).replace(
                /\n/g,
                "<br/>"
              )}
            </p>

          </div>

        </div>

      </div>

    </div>

  </div>


  <!-- FOOTER -->

  <div class="footer">

    <div class="bottom-left-ribbon">

      <div class="shape-light"></div>
      <div class="shape-dark"></div>

    </div>

    <div class="footer-inner">

      <div class="footer-contact">

        <div class="footer-item">
          ${icon("globe")}
          ${escapeHtml(
            company.website ||
              "flaremindstech.com"
          )}
        </div>

        <div class="footer-item">
          ${icon("phone")}
          ${escapeHtml(
            company.phone ||
              "+91 95009 50813"
          )}
        </div>

        <div class="footer-item">
          ${icon("mail")}
          ${escapeHtml(
            company.email ||
              "info@flaremindstech.com"
          )}
        </div>

      </div>


      <div class="footer-socials">

        ${socialIcon("facebook")}
        ${socialIcon("instagram")}
        ${socialIcon("linkedin")}
        ${socialIcon("youtube")}

      </div>

    </div>

  </div>

</div>

</body>
</html>`;
}