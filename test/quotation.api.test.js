import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-secret-value-at-least-32-characters";
process.env.JWT_ISSUER = "flareminds-billing";
process.env.JWT_AUDIENCE = "flareminds-admin";
process.env.SMTP_HOST = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASS = "";
process.env.SMTP_FROM = "";
process.env.WHATSAPP_PHONE_NUMBER_ID = "";
process.env.WHATSAPP_ACCESS_TOKEN = "";

const { default: Admin } = await import("../models/Admin.js");
const { default: Client } = await import("../models/Client.js");
const { default: Company } = await import("../models/Company.js");
const { default: Quotation } = await import("../models/Quotation.js");
const { default: Invoice } = await import("../models/Invoice.js");
const { signAccessToken } = await import("../utils/token.js");
const { computeQuotationTotals } = await import("../services/quotationCalculator.js");
const { closePdfBrowser } = await import("../services/pdfService.js");
const { ensureDefaultTemplates } = await import("../services/templateService.js");
const { app } = await import("../server.js");

let mongod;
let auth;
let client;

const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const payload = (overrides = {}) => ({
  client: client._id,
  issueDate: isoDay(0),
  validUntil: isoDay(30),
  currency: "INR",
  lineItems: [
    {
      description: "Custom software development",
      category: "software",
      unit: "project",
      quantity: 1,
      unitPrice: 100000,
      discountType: "percent",
      discountValue: 10,
      taxPercent: 18,
    },
    {
      description: "Training workshop",
      category: "course",
      unit: "day",
      quantity: 2,
      unitPrice: 5000,
      discountType: "none",
      taxPercent: 18,
    },
  ],
  notes: "Generic quotation for any product or service.",
  termsAndConditions: "50% advance, balance on delivery.",
  paymentTerms: "Net 15",
  deliveryTimeline: "4 weeks",
  warrantyTerms: "90 days",
  exclusions: "Third-party licenses excluded",
  ...overrides,
});

const post = (path, body, token = auth) =>
  request(app).post(path).set("Authorization", `Bearer ${token}`).send(body);

const put = (path, body, token = auth) =>
  request(app).put(path).set("Authorization", `Bearer ${token}`).send(body);

const get = (path, token = auth) =>
  request(app).get(path).set("Authorization", `Bearer ${token}`);

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([
    Admin.syncIndexes(),
    Client.syncIndexes(),
    Company.syncIndexes(),
    Quotation.syncIndexes(),
    Invoice.syncIndexes(),
  ]);

  const company = await Company.create({
    name: "Test Billing Co",
    code: "TEST",
    invoicePrefix: "FM",
    quotationPrefix: "FM-QTN",
  });
  await ensureDefaultTemplates(company._id);

  const admin = await Admin.create({
    email: "admin@example.com",
    passwordHash: "not-used-in-tests",
    name: "Test Admin",
    role: "company_admin",
    companyId: company._id,
  });
  auth = signAccessToken(admin);

  client = await Client.create({
    companyId: company._id,
    name: "Acme Retail",
    company: "Acme Pvt Ltd",
    address: "12 Market Road",
    email: "buyer@acme.test",
    whatsapp: "919876543210",
    phone: "+91 98765 43210",
    gstn: "33ABCDE1234F1Z5",
  });
});

after(async () => {
  await closePdfBrowser();
  await mongoose.disconnect();
  await mongod.stop();
});

test("quotation routes require authentication", async () => {
  const res = await request(app).get("/api/quotations");
  assert.equal(res.status, 401);
  assert.equal(res.body.message, "Not authenticated");
});

test("creates a quotation with server-owned number, totals and snapshot", async () => {
  const res = await post("/api/quotations", {
    ...payload(),
    // Deliberately tampered server-owned fields; all must be ignored.
    quotationNumber: "FM-QTN-1999-9999",
    status: "accepted",
    subTotal: 1,
    taxTotal: 1,
    grandTotal: 1,
    clientSnapshot: { name: "Hacker" },
    sentLog: [{ channel: "email", to: "x@y.z", success: true }],
  });

  assert.equal(res.status, 201);
  const q = res.body;
  assert.match(q.quotationNumber, /^FM-QTN-\d{4}-\d{4,}$/);
  assert.equal(q.status, "draft");
  assert.equal(q.client._id, String(client._id));
  assert.equal(q.clientSnapshot.name, "Acme Retail");
  assert.equal(q.clientSnapshot.gstn, "33ABCDE1234F1Z5");
  assert.equal(q.subTotal, 110000);
  // 100000 - 10% = 90000 taxed at 18% (16200); 2 x 5000 = 10000 taxed (1800).
  assert.equal(q.discountTotal, 10000);
  assert.equal(q.taxTotal, 18000);
  assert.equal(q.grandTotal, 118000);
  assert.equal(q.sentLog.length, 0);
});

test("rejects invalid numeric values and malformed discount types", async () => {
  const cases = [
    { lineItems: [{ description: "Bad", quantity: 0, unitPrice: 10 }] },
    { lineItems: [{ description: "Bad", quantity: 1, unitPrice: -1 }] },
    { lineItems: [{ description: "Bad", quantity: 1, unitPrice: 10, discountType: "bogus" }] },
    { lineItems: [{ description: "Bad", quantity: 1, unitPrice: 10, discountType: "percent", discountValue: 101 }] },
    { lineItems: [{ description: "Bad", quantity: 1, unitPrice: 10, taxPercent: 101 }] },
    { lineItems: [{ description: "Bad", quantity: "NaN", unitPrice: 10 }] },
    { lineItems: [] },
  ];

  for (const body of cases) {
    const res = await post("/api/quotations", payload(body));
    assert.equal(res.status, 400, JSON.stringify(res.body));
  }
});

test("validates client references and ObjectIds", async () => {
  const missingClient = await post(
    "/api/quotations",
    payload({ client: new mongoose.Types.ObjectId().toString() })
  );
  assert.equal(missingClient.status, 400);

  const badId = await get("/api/quotations/not-an-object-id");
  assert.equal(badId.status, 404);

  const notFound = await get(`/api/quotations/${new mongoose.Types.ObjectId()}`);
  assert.equal(notFound.status, 404);
});

test("allocates unique quotation numbers under concurrent creation", async () => {
  const responses = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      post(
        "/api/quotations",
        payload({
          notes: `concurrent-${i}`,
          lineItems: [
            { description: `Concurrent item ${i}`, quantity: 1, unitPrice: 10, taxPercent: 0 },
          ],
        })
      )
    )
  );

  const numbers = responses.map((res) => {
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.quotationNumber;
  });

  assert.equal(new Set(numbers).size, numbers.length);
  const sequences = numbers.map((n) => Number(n.split("-").pop()));
  assert.equal(new Set(sequences).size, sequences.length);
});

test("updates a draft, recalculates totals and ignores server-owned fields", async () => {
  const created = await post("/api/quotations", payload());
  const id = created.body._id;
  const originalNumber = created.body.quotationNumber;

  const res = await put(`/api/quotations/${id}`, {
    notes: "Revised offer",
    quotationNumber: "FM-QTN-1999-9998",
    status: "accepted",
    grandTotal: 5,
    lineItems: [
      {
        description: "Revised scope",
        category: "service",
        unit: "hour",
        quantity: 2.5,
        unitPrice: 400,
        discountType: "amount",
        discountValue: 100,
        taxPercent: 18,
      },
    ],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.quotationNumber, originalNumber);
  assert.equal(res.body.status, "draft");
  assert.equal(res.body.notes, "Revised offer");
  assert.equal(res.body.subTotal, 1000);
  assert.equal(res.body.discountTotal, 100);
  assert.equal(res.body.taxTotal, 162);
  assert.equal(res.body.grandTotal, 1062);

  const accept = await post(`/api/quotations/${id}/accept`);
  assert.equal(accept.status, 200);

  const locked = await put(`/api/quotations/${id}`, { notes: "late edit" });
  assert.equal(locked.status, 409);
});

test("lists with server-side pagination, filters, search and stable ordering", async () => {
  const first = await post("/api/quotations", payload({ notes: "list-target-alpha" }));
  await post("/api/quotations", payload({ notes: "list-target-beta" }));
  await post(`/api/quotations/${first.body._id}/accept`);

  const page = await get("/api/quotations?page=1&limit=2");
  assert.equal(page.status, 200);
  assert.equal(page.body.data.length, 2);
  assert.ok(page.body.total >= 3);
  assert.equal(page.body.page, 1);
  assert.ok(page.body.stats.all.count >= 3);

  const byNumber = await get(
    `/api/quotations?search=${encodeURIComponent(first.body.quotationNumber)}`
  );
  assert.equal(byNumber.status, 200);
  assert.equal(byNumber.body.data.length, 1);
  assert.equal(byNumber.body.data[0]._id, first.body._id);

  const byClient = await get(
    `/api/quotations?client=${client._id}&status=accepted&limit=100`
  );
  assert.equal(byClient.status, 200);
  assert.ok(byClient.body.data.every((q) => q.status === "accepted"));
  assert.ok(byClient.body.data.some((q) => q._id === first.body._id));

  const badStatus = await get("/api/quotations?status=paid");
  assert.equal(badStatus.status, 400);

  const operatorInjection = await request(app)
    .get("/api/quotations?status[$ne]=draft")
    .set("Authorization", `Bearer ${auth}`);
  assert.equal(operatorInjection.status, 400);
});

test("expired quotations cannot be accepted", async () => {
  const totals = computeQuotationTotals([
    {
      description: "Expired item",
      category: "other",
      unit: "unit",
      quantity: 1,
      unitPrice: 100,
      discountType: "none",
      discountValue: 0,
      taxPercent: 0,
    },
  ]);

  const expired = await Quotation.create({
    companyId: client.companyId,
    quotationNumber: "FM-QTN-2000-0001",
    client: client._id,
    clientSnapshot: { name: client.name, email: client.email },
    issueDate: new Date(Date.now() - 10 * 86400000),
    validUntil: new Date(Date.now() - 86400000),
    status: "sent",
    lineItems: totals.items,
    subTotal: totals.subTotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    shippingCharges: totals.shippingCharges,
    grandTotal: totals.grandTotal,
  });

  const accept = await post(`/api/quotations/${expired._id}/accept`);
  assert.equal(accept.status, 409);

  const list = await get("/api/quotations?status=expired&limit=100");
  assert.equal(list.status, 200);
  assert.ok(list.body.data.some((q) => q._id === String(expired._id)));
});

test("rejects and deletes only permitted statuses", async () => {
  const rejected = await post("/api/quotations", payload());
  const reject = await post(`/api/quotations/${rejected.body._id}/reject`, {
    note: "Budget declined",
  });
  assert.equal(reject.status, 200);
  assert.equal(reject.body.quotation.status, "rejected");
  assert.equal(reject.body.quotation.decisionNote, "Budget declined");

  const delRejected = await request(app)
    .delete(`/api/quotations/${rejected.body._id}`)
    .set("Authorization", `Bearer ${auth}`);
  assert.equal(delRejected.status, 200);

  const accepted = await post("/api/quotations", payload());
  await post(`/api/quotations/${accepted.body._id}/accept`);
  const delAccepted = await request(app)
    .delete(`/api/quotations/${accepted.body._id}`)
    .set("Authorization", `Bearer ${auth}`);
  assert.equal(delAccepted.status, 409);
});

test("generates a valid quotation PDF with correct headers, including long content", async () => {
  const manyItems = Array.from({ length: 60 }, (_, i) => ({
    description:
      i === 0
        ? `A very long description ${"with detail ".repeat(80)}`
        : `Line item ${i + 1}`,
    category: i % 3 === 0 ? "hardware" : i % 3 === 1 ? "service" : "training",
    unit: i % 2 === 0 ? "unit" : "hour",
    quantity: i + 1,
    unitPrice: 1250.5,
    discountType: i % 4 === 0 ? "percent" : "none",
    discountValue: i % 4 === 0 ? 5 : 0,
    taxPercent: 18,
  }));

  const created = await post(
    "/api/quotations",
    payload({
      lineItems: manyItems,
      termsAndConditions: "Long terms. ".repeat(200),
    })
  );
  assert.equal(created.status, 201);

  const res = await get(`/api/quotations/${created.body._id}/pdf`);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /application\/pdf/);
  assert.match(res.headers["content-disposition"], /inline; filename="Quotation-FM-QTN-/);
  assert.ok(Buffer.isBuffer(res.body));
  assert.equal(res.body.subarray(0, 5).toString(), "%PDF-");
  // 60 lines plus long terms must span more than one A4 page.
  const pageMarkers = res.body.toString("latin1").match(/\/Type\s*\/Page\b/g) || [];
  assert.ok(pageMarkers.length >= 2, `expected a multi-page PDF, got ${pageMarkers.length} page markers`);
});

test("records email failure accurately and does not mark the quotation sent", async () => {
  const created = await post("/api/quotations", payload());
  const res = await post(`/api/quotations/${created.body._id}/send-email`);

  assert.equal(res.status, 502);
  const stored = await Quotation.findById(created.body._id);
  assert.equal(stored.status, "draft");
  assert.equal(stored.sentLog.length, 1);
  assert.equal(stored.sentLog[0].channel, "email");
  assert.equal(stored.sentLog[0].success, false);
  assert.ok(stored.sentLog[0].error.length > 0);
});

test("records WhatsApp failure with a manual share fallback", async () => {
  const created = await post("/api/quotations", payload());
  const res = await post(`/api/quotations/${created.body._id}/send-whatsapp`);

  assert.equal(res.status, 502);
  assert.match(res.body.shareLink, /^https:\/\/wa\.me\/919876543210\?text=/);

  const stored = await Quotation.findById(created.body._id);
  assert.equal(stored.status, "draft");
  assert.equal(stored.sentLog[0].channel, "whatsapp");
  assert.equal(stored.sentLog[0].success, false);
});

test("converts an accepted quotation once and is idempotent on retry", async () => {
  const created = await post(
    "/api/quotations",
    payload({ shippingCharges: 500 })
  );
  await post(`/api/quotations/${created.body._id}/accept`);

  const first = await post(`/api/quotations/${created.body._id}/convert-to-invoice`);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.match(first.body.invoice.invoiceNumber, /^FM-\d{4}-\d{4,}$/);
  assert.equal(first.body.invoice.status, "draft");
  assert.equal(first.body.invoice.sourceQuotation, created.body._id);
  assert.equal(first.body.quotation.status, "converted");
  assert.equal(String(first.body.quotation.convertedInvoice), String(first.body.invoice._id));
  // Invoice total reproduces the quoted total (uniform tax + adjusted shipping).
  assert.ok(
    Math.abs(first.body.invoice.grandTotal - first.body.quotation.grandTotal) < 0.01,
    `${first.body.invoice.grandTotal} != ${first.body.quotation.grandTotal}`
  );

  const retry = await post(`/api/quotations/${created.body._id}/convert-to-invoice`);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.invoice._id, first.body.invoice._id);

  const invoices = await Invoice.find({ sourceQuotation: created.body._id });
  assert.equal(invoices.length, 1);

  const deleteConverted = await request(app)
    .delete(`/api/quotations/${created.body._id}`)
    .set("Authorization", `Bearer ${auth}`);
  assert.equal(deleteConverted.status, 409);
});

test("concurrent conversion requests create at most one invoice", async () => {
  const created = await post("/api/quotations", payload());
  await post(`/api/quotations/${created.body._id}/accept`);

  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      post(`/api/quotations/${created.body._id}/convert-to-invoice`)
    )
  );

  for (const res of responses) {
    assert.ok([200, 201, 409].includes(res.status), `unexpected ${res.status}`);
  }
  assert.ok(responses.some((res) => [200, 201].includes(res.status)));

  const invoices = await Invoice.find({ sourceQuotation: created.body._id });
  assert.equal(invoices.length, 1);

  const quotation = await Quotation.findById(created.body._id);
  assert.equal(quotation.status, "converted");
  assert.equal(String(quotation.convertedInvoice), String(invoices[0]._id));
});

test("only accepted quotations can convert and mixed tax rates are refused", async () => {
  const draft = await post("/api/quotations", payload());
  const notAccepted = await post(`/api/quotations/${draft.body._id}/convert-to-invoice`);
  assert.equal(notAccepted.status, 409);

  const mixed = await post(
    "/api/quotations",
    payload({
      lineItems: [
        { description: "A", quantity: 1, unitPrice: 100, taxPercent: 18 },
        { description: "B", quantity: 1, unitPrice: 100, taxPercent: 5 },
      ],
    })
  );
  await post(`/api/quotations/${mixed.body._id}/accept`);
  const res = await post(`/api/quotations/${mixed.body._id}/convert-to-invoice`);
  assert.equal(res.status, 409);
  assert.match(res.body.message, /different tax rates/i);
});

test("existing invoice creation and numbering remain intact", async () => {
  const res = await post("/api/invoices", {
    client: client._id,
    date: isoDay(0),
    dueDate: isoDay(15),
    taxPercent: 18,
    lineItems: [{ description: "Invoice regression check", quantity: 2, rate: 1000 }],
  });

  assert.equal(res.status, 201);
  assert.match(res.body.invoiceNumber, /^FM-\d{4}-\d{4,}$/);
  assert.equal(res.body.subTotal, 2000);
  assert.equal(res.body.taxAmount, 360);
  assert.equal(res.body.grandTotal, 2360);
  assert.equal(res.body.sourceQuotation, undefined);
});
