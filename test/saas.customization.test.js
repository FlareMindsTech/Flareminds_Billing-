import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-only-secret-value-at-least-32-characters";
process.env.JWT_ISSUER = "flareminds-billing";
process.env.JWT_AUDIENCE = "flareminds-admin";

const { default: Admin } = await import("../models/Admin.js");
const { default: Client } = await import("../models/Client.js");
const { default: Company } = await import("../models/Company.js");
const { default: Quotation } = await import("../models/Quotation.js");
const { default: Invoice } = await import("../models/Invoice.js");
const { signAccessToken } = await import("../utils/token.js");
const { closePdfBrowser } = await import("../services/pdfService.js");
const { app } = await import("../server.js");

let mongod;
let auth;
let tenantAuth;
let client;

const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

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

  const admin = await Admin.create({
    email: "saas-admin@example.com",
    passwordHash: "not-used",
    name: "SaaS Admin",
    role: "superadmin",
  });
  auth = signAccessToken(admin);
});

after(async () => {
  await closePdfBrowser();
  await mongoose.disconnect();
  await mongod.stop();
});

test("SaaS Multi-Company: create company with custom fields, item fields & labels", async () => {
  const payload = {
    name: "Acme Healthcare Innovations",
    code: "ACME",
    invoicePrefix: "ACME",
    quotationPrefix: "ACME-QTN",
    currency: "USD",
    defaultTaxPercent: 10,
    customLabels: {
      quotationTitle: "COMMERCIAL PROPOSAL",
      invoiceTitle: "OFFICIAL INVOICE",
      clientSectionTitle: "CLIENT INFORMATION",
      itemDescriptionLabel: "Service / Equipment",
      itemQuantityLabel: "Units",
      itemRateLabel: "Unit Price",
    },
    customFields: [
      {
        key: "poNumber",
        label: "Purchase Order #",
        type: "text",
        required: true,
        appliesTo: "both",
      },
      {
        key: "salesRep",
        label: "Sales Representative",
        type: "select",
        options: ["Alice", "Bob", "Charlie"],
        required: false,
        appliesTo: "quotation",
      },
    ],
    itemCustomFields: [
      {
        key: "serialNumber",
        label: "Serial / Model No",
        type: "text",
        required: false,
      },
    ],
    bank: {
      accountName: "Acme Healthcare Corp",
      accountNumber: "987654321098",
      ifsc: "ACME0001234",
    },
  };

  const res = await request(app)
    .post("/api/admin/companies")
    .set("Authorization", `Bearer ${auth}`)
    .send({
      company: payload,
      admin: {
        name: "Acme Admin",
        email: "acme-admin@example.com",
        password: "AcmePassword@123",
      },
    });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.company.code, "ACME");
  assert.equal(res.body.company.customFields.length, 2);
  assert.equal(res.body.company.itemCustomFields.length, 1);
  assert.equal(res.body.company.customLabels.quotationTitle, "COMMERCIAL PROPOSAL");

  const tenantAdmin = await Admin.findOne({ email: "acme-admin@example.com" });
  tenantAuth = signAccessToken(tenantAdmin);
  client = await Client.create({
    companyId: res.body.company._id,
    name: "Apex Healthcare",
    company: "Apex Hospitals Pvt Ltd",
    email: "billing@apexhospitals.com",
    phone: "+91 9988776655",
  });
});

test("SaaS Multi-Company: enforce required custom fields and select validation", async () => {
  const acme = await Company.findOne({ code: "ACME" });
  assert.ok(acme);

  // Missing required "poNumber"
  const missingRequired = await request(app)
    .post("/api/quotations")
    .set("Authorization", `Bearer ${tenantAuth}`)
    .set("X-Company-Id", String(acme._id))
    .send({
      client: client._id,
      issueDate: isoDay(0),
      validUntil: isoDay(15),
      lineItems: [
        {
          description: "Hospital MRI Machine Software",
          quantity: 1,
          unitPrice: 50000,
        },
      ],
      customFields: {},
    });

  assert.equal(missingRequired.status, 400);
  assert.match(missingRequired.body.message, /Purchase Order # is required/);

  // Invalid option for "salesRep"
  const invalidOption = await request(app)
    .post("/api/quotations")
    .set("Authorization", `Bearer ${tenantAuth}`)
    .set("X-Company-Id", String(acme._id))
    .send({
      client: client._id,
      issueDate: isoDay(0),
      validUntil: isoDay(15),
      lineItems: [
        {
          description: "Hospital MRI Machine Software",
          quantity: 1,
          unitPrice: 50000,
        },
      ],
      customFields: {
        poNumber: "PO-ACME-9001",
        salesRep: "NonExistentRep",
      },
    });

  assert.equal(invalidOption.status, 400);
  assert.match(invalidOption.body.message, /Invalid option/);
});

test("SaaS Multi-Company: creates quotation with company prefix and custom fields", async () => {
  const acme = await Company.findOne({ code: "ACME" });
  const year = new Date().getFullYear();

  const res = await request(app)
    .post("/api/quotations")
    .set("Authorization", `Bearer ${tenantAuth}`)
    .set("X-Company-Id", String(acme._id))
    .send({
      client: client._id,
      issueDate: isoDay(0),
      validUntil: isoDay(20),
      lineItems: [
        {
          description: "Cardiology Monitoring Suite",
          unit: "license",
          quantity: 2,
          unitPrice: 15000,
          customFields: {
            serialNumber: "SN-CARDIO-8821",
          },
        },
      ],
      customFields: {
        poNumber: "PO-ACME-9001",
        salesRep: "Alice",
      },
    });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.quotationNumber, `ACME-QTN-${year}-0001`);
  assert.equal(String(res.body.companyId), String(acme._id));
  assert.equal(res.body.customFields.poNumber, "PO-ACME-9001");
  assert.equal(res.body.customFields.salesRep, "Alice");
  assert.equal(res.body.lineItems[0].customFields.serialNumber, "SN-CARDIO-8821");
});

test("SaaS Multi-Company: convert quotation to invoice carries companyId and custom fields", async () => {
  const acme = await Company.findOne({ code: "ACME" });
  const year = new Date().getFullYear();

  const qtn = await Quotation.findOne({ quotationNumber: `ACME-QTN-${year}-0001` });
  assert.ok(qtn);

  // Accept quotation
  const accepted = await request(app)
    .post(`/api/quotations/${qtn._id}/accept`)
    .set("Authorization", `Bearer ${tenantAuth}`)
    .set("X-Company-Id", String(acme._id));
  assert.equal(accepted.status, 200);

  // Convert to invoice
  const conv = await request(app)
    .post(`/api/quotations/${qtn._id}/convert-to-invoice`)
    .set("Authorization", `Bearer ${tenantAuth}`)
    .set("X-Company-Id", String(acme._id));

  assert.equal(conv.status, 201, JSON.stringify(conv.body));
  assert.equal(conv.body.invoice.invoiceNumber, `ACME-${year}-0001`);
  assert.equal(String(conv.body.invoice.companyId), String(acme._id));
  assert.equal(conv.body.invoice.customFields.poNumber, "PO-ACME-9001");
  assert.equal(conv.body.invoice.lineItems[0].customFields.serialNumber, "SN-CARDIO-8821");
});

test("SaaS Multi-Company: quotation PDF renders company branding, custom title & fields", async () => {
  const acme = await Company.findOne({ code: "ACME" });
  const year = new Date().getFullYear();
  const qtn = await Quotation.findOne({ quotationNumber: `ACME-QTN-${year}-0001` });

  const pdfRes = await request(app)
    .get(`/api/quotations/${qtn._id}/pdf`)
    .set("Authorization", `Bearer ${tenantAuth}`)
    .set("X-Company-Id", String(acme._id));

  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers["content-type"], "application/pdf");
  assert.ok(pdfRes.body.length > 1000);
});

test("SaaS Multi-Company: GET /api/companies/current returns active company", async () => {
  const acme = await Company.findOne({ code: "ACME" });

  const res = await request(app)
    .get("/api/companies/current")
    .set("Authorization", `Bearer ${tenantAuth}`)
    .set("X-Company-Id", String(acme._id));

  assert.equal(res.status, 200);
  assert.equal(res.body.code, "ACME");
  assert.equal(res.body.name, "Acme Healthcare Innovations");
});


test("SaaS Roles: superadmin cannot access tenant CRUD endpoints", async () => {
  const acme = await Company.findOne({ code: "ACME" });
  assert.ok(acme);

  const qtnRes = await request(app)
    .get("/api/quotations")
    .set("Authorization", `Bearer ${auth}`)
    .set("X-Company-Id", String(acme._id));
  assert.equal(qtnRes.status, 403);
  assert.match(qtnRes.body.message, /Company administrator access required/);

  const invRes = await request(app)
    .get("/api/invoices")
    .set("Authorization", `Bearer ${auth}`)
    .set("X-Company-Id", String(acme._id));
  assert.equal(invRes.status, 403);
  assert.match(invRes.body.message, /Company administrator access required/);
});

test("SaaS Platform: superadmin can access platform overview", async () => {
  const res = await request(app)
    .get("/api/admin/overview")
    .set("Authorization", `Bearer ${auth}`);

  assert.equal(res.status, 200);
  assert.ok(res.body.companies);
  assert.ok(res.body.invoices);
  assert.ok(res.body.quotations);
  assert.ok(res.body.companyOverview);
  assert.ok(Array.isArray(res.body.companyOverview));
});
