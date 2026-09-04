import nodemailer from "nodemailer";

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
    });
  }
  return transporter;
}

// Emails the invoice PDF as an attachment.
export async function sendInvoiceEmail({ to, invoiceNumber, clientName, pdfBuffer }) {
  const mailer = getTransporter();

  await mailer.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: `Invoice ${invoiceNumber} from ${process.env.COMPANY_NAME}`,
    text: `Hi ${clientName},\n\nPlease find attached invoice ${invoiceNumber}.\n\nThank you for your business.\n\n${process.env.COMPANY_NAME}`,
    html: `<p>Hi ${clientName},</p><p>Please find attached invoice <b>${invoiceNumber}</b>.</p><p>Thank you for your business.</p><p>${process.env.COMPANY_NAME}</p>`,
    attachments: [
      {
        filename: `Invoice-${invoiceNumber}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}
