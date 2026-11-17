import test from "node:test";
import assert from "node:assert/strict";

const { renderDynamicDocumentHTML } = await import("../templates/dynamicRenderer.js");
const { renderInvoiceHTML } = await import("../templates/invoiceTemplate.js");

const invoice = {
  invoiceNumber: "PAY-PDF-2026-0001",
  status: "partially_paid",
  date: "2026-11-01T00:00:00.000Z",
  dueDate: "2026-11-20T00:00:00.000Z",
  lineItems: [
    {
      description: "Payment PDF work",
      category: "other",
      quantity: 1,
      rate: 1000,
      amount: 1000,
      customFields: {},
    },
  ],
  subTotal: 1000,
  taxPercent: 0,
  taxAmount: 0,
  grandTotal: 1000,
  amountPaid: 250,
  balanceDue: 750,
  notes: "",
  customFields: {},
};

const client = {
  name: "PDF Payments Client",
  company: "PDF Client Co",
  email: "pdf-client@test.local",
};

const company = {
  name: "PDF Payments Company",
  address: "1 Test Street",
  email: "billing@test.local",
  phone: "9999999999",
  bank: {},
};

const baseTemplate = {
  name: "PDF payment summary",
  layout: { preset: "classic" },
  labels: {},
  content: { showPaymentSummary: true },
  columns: {},
  customFields: [],
  itemCustomFields: [],
  sections: [
    { key: "header", enabled: true, order: 0 },
    { key: "meta", enabled: true, order: 1 },
    { key: "client", enabled: true, order: 2 },
    { key: "items", enabled: true, order: 3 },
    { key: "totals", enabled: true, order: 4 },
  ],
};

const renderDynamic = (template) =>
  renderDynamicDocumentHTML({
    docType: "invoice",
    doc: invoice,
    client,
    company,
    template,
  });

test("classic invoice PDF shows paid and balance due", () => {
  const html = renderDynamic(baseTemplate);
  assert.match(html, /Paid/);
  assert.match(html, /Balance Due/);
  assert.match(html, /750\.00/);
});

test("tax and corporate invoice PDFs show paid and balance due", () => {
  for (const preset of ["tax-invoice", "premium-invoice"]) {
    const html = renderDynamic({
      ...baseTemplate,
      layout: { ...baseTemplate.layout, preset },
    });
    assert.match(html, /Balance Due/, preset);
    assert.match(html, /750\.00/, preset);
  }
});

test("templates can hide the payment summary on invoice PDFs", () => {
  for (const preset of ["classic", "tax-invoice", "premium-invoice"]) {
    const html = renderDynamic({
      ...baseTemplate,
      layout: { ...baseTemplate.layout, preset },
      content: { showPaymentSummary: false },
    });
    assert.doesNotMatch(html, /Balance Due/, preset);
  }
});

test("legacy invoice PDF shows paid and balance due and respects the flag", () => {
  const visible = renderInvoiceHTML({
    invoice,
    client,
    company,
    template: baseTemplate,
  });
  assert.match(visible, /PAID/);
  assert.match(visible, /BALANCE DUE/);
  assert.match(visible, /750\.00/);

  const hidden = renderInvoiceHTML({
    invoice,
    client,
    company,
    template: { ...baseTemplate, content: { showPaymentSummary: false } },
  });
  assert.doesNotMatch(hidden, /BALANCE DUE/);
});
