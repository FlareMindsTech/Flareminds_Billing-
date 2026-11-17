import nodemailer from "nodemailer";

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const singleLine = (value = "") => String(value).replace(/[\r\n]+/g, " ");

let transporter;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }
  return transporter;
}

// Generic document delivery used by both invoices and quotations.
async function sendDocumentEmail({ to, subject, text, html, filename, pdfBuffer }) {
  if (!process.env.SMTP_HOST) {
    throw new Error("Email is not configured (SMTP_HOST is missing)");
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) {
    throw new Error("Email is not configured (SMTP_FROM is missing)");
  }

  const recipient = singleLine(to).trim();
  if (!recipient) {
    throw new Error("Email recipient is required");
  }

  const mailer = getTransporter();

  await mailer.sendMail({
    from: singleLine(from),
    to: recipient,
    subject: singleLine(subject),
    text,
    html,
    attachments: [
      {
        filename: singleLine(filename),
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}

// Emails the invoice PDF as an attachment.
export async function sendInvoiceEmail({ to, invoiceNumber, clientName, pdfBuffer, companyName }) {
  const compName = companyName || process.env.COMPANY_NAME || "FlareMinds";
  const subject = `Invoice ${singleLine(invoiceNumber)} from ${singleLine(compName)}`;

  await sendDocumentEmail({
    to,
    subject,
    text: `Hi ${singleLine(clientName)},\n\nPlease find attached invoice ${singleLine(
      invoiceNumber
    )}.\n\nThank you for your business.\n\n${compName}`,
    html: `<p>Hi ${escapeHtml(clientName)},</p><p>Please find attached invoice <b>${escapeHtml(
      invoiceNumber
    )}</b>.</p><p>Thank you for your business.</p><p>${escapeHtml(compName)}</p>`,
    filename: `Invoice-${singleLine(invoiceNumber)}.pdf`,
    pdfBuffer,
  });
}

// Emails the quotation PDF as an attachment.
export async function sendQuotationEmail({ to, quotationNumber, clientName, pdfBuffer, companyName }) {
  const compName = companyName || process.env.COMPANY_NAME || "FlareMinds";
  const subject = `Quotation ${singleLine(quotationNumber)} from ${singleLine(compName)}`;

  await sendDocumentEmail({
    to,
    subject,
    text: `Hi ${singleLine(clientName)},\n\nPlease find attached quotation ${singleLine(
      quotationNumber
    )}.\n\nThank you for your interest.\n\n${compName}`,
    html: `<p>Hi ${escapeHtml(clientName)},</p><p>Please find attached quotation <b>${escapeHtml(
      quotationNumber
    )}</b>.</p><p>Thank you for your interest.</p><p>${escapeHtml(compName)}</p>`,
    filename: `Quotation-${singleLine(quotationNumber)}.pdf`,
    pdfBuffer,
  });
}
