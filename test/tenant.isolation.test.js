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
const { default: DocumentTemplate } = await import("../models/DocumentTemplate.js");
const { default: Invoice } = await import("../models/Invoice.js");
const { default: Quotation } = await import("../models/Quotation.js");
const { signAccessToken } = await import("../utils/token.js");
const { closePdfBrowser } = await import("../services/pdfService.js");
const { getCurrentCompany } = await import("../controllers/companyController.js");
const { app } = await import("../server.js");

let mongod;
let superToken;
let companyA;
let companyB;
let tokenA;
let tokenB;

let clientA;
let clientB;
let invoiceA;
let invoiceB;
let quotationA;
let quotationB;
let templateA;
let templateB;

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
    DocumentTemplate.syncIndexes(),
    Invoice.syncIndexes(),
    Quotation.syncIndexes(),
  ]);

  const superadmin = await Admin.create({
    email: "superadmin@platform.test",
    passwordHash: await Admin.hashPassword("SuperSecret@123"),
    name: "Platform SuperAdmin",
    role: "superadmin",
  });
  superToken = signAccessToken(superadmin);

  // 1. Provision Company A & Admin A
  const resA = await request(app)
    .post("/api/admin/companies")
    .set("Authorization", `Bearer ${superToken}`)
    .send({
      name: "Tenant Alpha Corp",
      code: "ALPHA",
      invoicePrefix: "ALPHA-INV",
      quotationPrefix: "ALPHA-QTN",
      admin: {
        email: "admin@alpha.test",
        password: "AlphaPassword@123",
        name: "Admin Alpha",
      },
    });
  assert.equal(resA.status, 201);
  companyA = resA.body.company;

  const loginA = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@alpha.test", password: "AlphaPassword@123" });
  assert.equal(loginA.status, 200);
  tokenA = loginA.body.token;

  // 2. Provision Company B & Admin B
  const resB = await request(app)
    .post("/api/admin/companies")
    .set("Authorization", `Bearer ${superToken}`)
    .send({
      name: "Tenant Beta Corp",
      code: "BETA",
      invoicePrefix: "BETA-INV",
      quotationPrefix: "BETA-QTN",
      admin: {
        email: "admin@beta.test",
        password: "BetaPassword@123",
        name: "Admin Beta",
      },
    });
  assert.equal(resB.status, 201);
  companyB = resB.body.company;

  const loginB = await request(app)
    .post("/api/auth/login")
    .send({ email: "admin@beta.test", password: "BetaPassword@123" });
  assert.equal(loginB.status, 200);
  tokenB = loginB.body.token;

  // 3. Create records for Company A
  clientA = await Client.create({
    companyId: companyA._id,
    name: "Alpha Customer 1",
    email: "cust1@alpha.test",
    phone: "1111111111",
  });

  const invResA = await request(app)
    .post("/api/invoices")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({
      client: clientA._id,
      date: isoDay(0),
      taxPercent: 10,
      lineItems: [{ description: "Alpha Dev Work", rate: 1000, quantity: 2 }],
    });
  assert.equal(invResA.status, 201);
  invoiceA = invResA.body;

  const qtnResA = await request(app)
    .post("/api/quotations")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({
      client: clientA._id,
      issueDate: isoDay(0),
      validUntil: isoDay(30),
      lineItems: [{ description: "Alpha Quote Work", unitPrice: 2000, quantity: 1 }],
    });
  assert.equal(qtnResA.status, 201);
  quotationA = qtnResA.body;

  const tplResA = await request(app)
    .post("/api/templates")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({
      docType: "invoice",
      name: "Alpha Custom Invoice Template",
      layout: { preset: "modern" },
    });
  assert.equal(tplResA.status, 201);
  templateA = tplResA.body;

  // 4. Create records for Company B
  clientB = await Client.create({
    companyId: companyB._id,
    name: "Beta Customer 1",
    email: "cust1@beta.test",
    phone: "2222222222",
  });

  const invResB = await request(app)
    .post("/api/invoices")
    .set("Authorization", `Bearer ${tokenB}`)
    .send({
      client: clientB._id,
      date: isoDay(0),
      taxPercent: 18,
      lineItems: [{ description: "Beta Marketing Work", rate: 5000, quantity: 1 }],
    });
  assert.equal(invResB.status, 201);
  invoiceB = invResB.body;

  const qtnResB = await request(app)
    .post("/api/quotations")
    .set("Authorization", `Bearer ${tokenB}`)
    .send({
      client: clientB._id,
      issueDate: isoDay(0),
      validUntil: isoDay(30),
      lineItems: [{ description: "Beta Quote Work", unitPrice: 3500, quantity: 2 }],
    });
  assert.equal(qtnResB.status, 201);
  quotationB = qtnResB.body;

  const tplResB = await request(app)
    .post("/api/templates")
    .set("Authorization", `Bearer ${tokenB}`)
    .send({
      docType: "quotation",
      name: "Beta Custom Quotation Template",
      layout: { preset: "compact" },
    });
  assert.equal(tplResB.status, 201);
  templateB = tplResB.body;
});

after(async () => {
  await closePdfBrowser();
  await mongoose.disconnect();
  await mongod.stop();
});

// ---------------------------------------------------------------------------
// CLIENT CROSS-TENANT ISOLATION
// ---------------------------------------------------------------------------

test("cross-tenant: company-A cannot list company-B clients", async () => {
  const res = await request(app)
    .get("/api/clients")
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 200);
  const ids = res.body.map((c) => String(c._id));
  assert.ok(ids.includes(String(clientA._id)), "Should include Company A client");
  assert.ok(!ids.includes(String(clientB._id)), "Must NOT include Company B client");
});

test("cross-tenant: company-A cannot read company-B client by ID", async () => {
  const res = await request(app)
    .get(`/api/clients/${clientB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 404);
  assert.match(res.body.message, /not found/i);
});

test("cross-tenant: company-A cannot update company-B client", async () => {
  const res = await request(app)
    .put(`/api/clients/${clientB._id}`)
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ name: "Hacked by Alpha" });
  assert.equal(res.status, 404);

  // Verify DB record unchanged
  const unchanged = await Client.findById(clientB._id);
  assert.equal(unchanged.name, "Beta Customer 1");
});

test("cross-tenant: company-A cannot delete company-B client", async () => {
  const res = await request(app)
    .delete(`/api/clients/${clientB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 404);

  // Verify DB record still exists
  const stillExists = await Client.findById(clientB._id);
  assert.ok(stillExists);
});

// ---------------------------------------------------------------------------
// INVOICE CROSS-TENANT ISOLATION
// ---------------------------------------------------------------------------

test("cross-tenant: company-A cannot list company-B invoices", async () => {
  const res = await request(app)
    .get("/api/invoices")
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 200);
  const ids = res.body.map((inv) => String(inv._id));
  assert.ok(ids.includes(String(invoiceA._id)), "Should include Company A invoice");
  assert.ok(!ids.includes(String(invoiceB._id)), "Must NOT include Company B invoice");
});

test("cross-tenant: company-A cannot read company-B invoice by ID", async () => {
  const res = await request(app)
    .get(`/api/invoices/${invoiceB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 404);
  assert.match(res.body.message, /not found/i);
});

test("cross-tenant: company-A cannot update company-B invoice", async () => {
  const res = await request(app)
    .put(`/api/invoices/${invoiceB._id}`)
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ notes: "Altered by Alpha" });
  assert.equal(res.status, 404);

  const unchanged = await Invoice.findById(invoiceB._id);
  assert.notEqual(unchanged.notes, "Altered by Alpha");
});

test("cross-tenant: company-A cannot delete company-B invoice", async () => {
  const res = await request(app)
    .delete(`/api/invoices/${invoiceB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 404);

  const stillExists = await Invoice.findById(invoiceB._id);
  assert.ok(stillExists);
});

test("cross-tenant: company-A cannot download company-B invoice PDF", async () => {
  const res = await request(app)
    .get(`/api/invoices/${invoiceB._id}/pdf`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 404);
});

test("cross-tenant: company-A cannot create invoice referencing company-B client", async () => {
  const res = await request(app)
    .post("/api/invoices")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({
      client: clientB._id,
      date: isoDay(0),
      lineItems: [{ description: "Rogue Invoice", rate: 500, quantity: 1 }],
    });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /client not found/i);
});

// ---------------------------------------------------------------------------
// QUOTATION CROSS-TENANT ISOLATION
// ---------------------------------------------------------------------------

test("cross-tenant: company-A cannot list company-B quotations", async () => {
  const res = await request(app)
    .get("/api/quotations")
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 200);
  const ids = res.body.data.map((q) => String(q._id));
  assert.ok(ids.includes(String(quotationA._id)), "Should include Company A quotation");
  assert.ok(!ids.includes(String(quotationB._id)), "Must NOT include Company B quotation");
});

test("cross-tenant: company-A cannot read company-B quotation by ID", async () => {
  const res = await request(app)
    .get(`/api/quotations/${quotationB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 404);
  assert.match(res.body.message, /not found/i);
});

test("cross-tenant: company-A cannot update company-B quotation", async () => {
  const res = await request(app)
    .put(`/api/quotations/${quotationB._id}`)
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ notes: "Altered by Alpha" });
  assert.equal(res.status, 404);

  const unchanged = await Quotation.findById(quotationB._id);
  assert.notEqual(unchanged.notes, "Altered by Alpha");
});

test("cross-tenant: company-A cannot delete company-B quotation", async () => {
  const res = await request(app)
    .delete(`/api/quotations/${quotationB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 404);

  const stillExists = await Quotation.findById(quotationB._id);
  assert.ok(stillExists);
});

test("cross-tenant: company-A cannot accept, reject or convert company-B quotation", async () => {
  const acceptRes = await request(app)
    .post(`/api/quotations/${quotationB._id}/accept`)
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ note: "Accepted by unauthorized tenant" });
  assert.equal(acceptRes.status, 404);

  const rejectRes = await request(app)
    .post(`/api/quotations/${quotationB._id}/reject`)
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ note: "Rejected by unauthorized tenant" });
  assert.equal(rejectRes.status, 404);

  const convertRes = await request(app)
    .post(`/api/quotations/${quotationB._id}/convert-to-invoice`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(convertRes.status, 404);
});

test("cross-tenant: company-A cannot create quotation referencing company-B client", async () => {
  const res = await request(app)
    .post("/api/quotations")
    .set("Authorization", `Bearer ${tokenA}`)
    .send({
      client: clientB._id,
      issueDate: isoDay(0),
      validUntil: isoDay(30),
      lineItems: [{ description: "Rogue Quote", unitPrice: 500, quantity: 1 }],
    });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /client not found/i);
});

// ---------------------------------------------------------------------------
// TEMPLATE CROSS-TENANT ISOLATION
// ---------------------------------------------------------------------------

test("cross-tenant: company-A cannot list company-B templates", async () => {
  const res = await request(app)
    .get("/api/templates")
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 200);
  const ids = res.body.map((t) => String(t._id));
  assert.ok(ids.includes(String(templateA._id)), "Should include Company A template");
  assert.ok(!ids.includes(String(templateB._id)), "Must NOT include Company B template");
});

test("cross-tenant: company-A cannot read company-B template by ID", async () => {
  const res = await request(app)
    .get(`/api/templates/${templateB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 404);
  assert.match(res.body.message, /not found/i);
});

test("cross-tenant: company-A cannot update company-B template", async () => {
  const res = await request(app)
    .put(`/api/templates/${templateB._id}`)
    .set("Authorization", `Bearer ${tokenA}`)
    .send({ name: "Alpha Hijacked Template" });
  assert.equal(res.status, 404);

  const unchanged = await DocumentTemplate.findById(templateB._id);
  assert.equal(unchanged.name, "Beta Custom Quotation Template");
});

test("cross-tenant: company-A cannot delete company-B template", async () => {
  const res = await request(app)
    .delete(`/api/templates/${templateB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 404);

  const stillExists = await DocumentTemplate.findById(templateB._id);
  assert.ok(stillExists);
});

test("cross-tenant: company-A cannot clone or set default on company-B template", async () => {
  const defaultRes = await request(app)
    .post(`/api/templates/${templateB._id}/default`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(defaultRes.status, 404);

  const cloneRes = await request(app)
    .post(`/api/templates/${templateB._id}/clone`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(cloneRes.status, 404);
});

// ---------------------------------------------------------------------------
// THE 4 SECURITY FIXES
// ---------------------------------------------------------------------------

test("Fix 1: listCompanies returns empty array when admin lacks companyId", async () => {
  // Create an admin without companyId
  const orphanAdmin = await Admin.create({
    email: "orphan-admin@test.local",
    passwordHash: await Admin.hashPassword("OrphanPass@123"),
    name: "Orphan Admin",
    role: "company_admin",
    companyId: null,
  });
  const orphanToken = signAccessToken(orphanAdmin);

  const res = await request(app)
    .get("/api/companies")
    .set("Authorization", `Bearer ${orphanToken}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [], "Orphan admin must receive an empty array, NOT all companies");
});

test("Fix 2: getCurrentCompany for company admin never falls back to platform default company", async () => {
  const deletedCompany = await Company.create({
    name: "To Be Deleted",
    code: "DELCO",
  });
  const tempAdmin = await Admin.create({
    email: "temp-admin@test.local",
    passwordHash: await Admin.hashPassword("TempPass@123"),
    name: "Temp Admin",
    role: "company_admin",
    companyId: deletedCompany._id,
  });
  const tempToken = signAccessToken(tempAdmin);

  // Delete the company
  await Company.findByIdAndDelete(deletedCompany._id);

  const res = await request(app)
    .get("/api/companies/current")
    .set("Authorization", `Bearer ${tempToken}`);
  // Rejects with 401 or 404; must never fall back to platform default company
  assert.ok([401, 404].includes(res.status), `Expected 401 or 404, got ${res.status}`);
  assert.notEqual(res.body?.code, "ALPHA");
  assert.notEqual(res.body?.code, "BETA");
  assert.notEqual(res.body?.code, "DEFAULT");
});

test("Fix 3: resolveCompany rejects non-superadmin without companyId with 403 Forbidden", async () => {
  const orphanAdmin = await Admin.findOne({ email: "orphan-admin@test.local" });
  const orphanToken = signAccessToken(orphanAdmin);

  const res = await request(app)
    .get("/api/companies/current")
    .set("Authorization", `Bearer ${orphanToken}`);
  assert.equal(res.status, 403);
  assert.match(res.body.message, /no company is assigned/i);
});

test("Fix 4: direct delete queries enforce companyId at database level", async () => {
  // Attempt to delete Company B quotation and template while authenticated as Company A
  const delQtn = await request(app)
    .delete(`/api/quotations/${quotationB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(delQtn.status, 404);

  const delTpl = await request(app)
    .delete(`/api/templates/${templateB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(delTpl.status, 404);

  // Both still exist in database
  assert.ok(await Quotation.findById(quotationB._id));
  assert.ok(await DocumentTemplate.findById(templateB._id));
});

// ---------------------------------------------------------------------------
// ADDITIONAL REGRESSION COVERAGE FOR THE 4 FIXES
// ---------------------------------------------------------------------------

test("Fix 1: listCompanies scopes company admins to their own company only", async () => {
  const own = await request(app)
    .get("/api/companies")
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(own.status, 200);
  assert.equal(own.body.length, 1, "Company A admin must see exactly one company");
  assert.equal(String(own.body[0]._id), String(companyA._id));

  const all = await request(app)
    .get("/api/companies")
    .set("Authorization", `Bearer ${superToken}`);
  assert.equal(all.status, 200);
  const ids = all.body.map((company) => String(company._id));
  assert.ok(ids.includes(String(companyA._id)));
  assert.ok(ids.includes(String(companyB._id)));
});

test("Fix 2: getCurrentCompany never returns the platform default to a company admin without one", async () => {
  // Company A is the platform default at this point, so the old fallback
  // behaviour would leak it to an unassigned company admin.
  const orphan = await Admin.create({
    email: "direct-orphan@test.local",
    passwordHash: await Admin.hashPassword("DirectOrphan@123"),
    name: "Direct Orphan Admin",
    role: "company_admin",
    companyId: null,
  });
  assert.ok(orphan);

  const req = {
    admin: { role: "company_admin", companyId: null },
    companyId: null,
    company: null,
    query: {},
    body: {},
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  await getCurrentCompany(req, res);
  assert.equal(res.statusCode, 404);
  assert.match(res.body.message, /no active company/i);
  assert.equal(res.body.code, undefined, "Must not fall back to the default company");
});

test("Fix 3: non-superadmin with no companyId gets 403 on every tenant-scoped endpoint", async () => {
  const orphan = await Admin.create({
    email: "no-company-admin@test.local",
    passwordHash: await Admin.hashPassword("NoCompany@123"),
    name: "No Company Admin",
    role: "company_admin",
    companyId: null,
  });
  const token = signAccessToken(orphan);

  const cases = [
    ["get", "/api/clients"],
    ["post", "/api/clients"],
    ["put", `/api/clients/${clientA._id}`],
    ["delete", `/api/clients/${clientA._id}`],
    ["get", "/api/invoices"],
    ["post", "/api/invoices"],
    ["put", `/api/invoices/${invoiceA._id}`],
    ["delete", `/api/invoices/${invoiceA._id}`],
    ["get", "/api/quotations"],
    ["post", "/api/quotations"],
    ["put", `/api/quotations/${quotationA._id}`],
    ["delete", `/api/quotations/${quotationA._id}`],
    ["get", "/api/templates"],
    ["post", "/api/templates"],
    ["put", `/api/templates/${templateA._id}`],
    ["delete", `/api/templates/${templateA._id}`],
    ["get", "/api/company"],
    ["put", "/api/company"],
    ["get", "/api/companies/current"],
  ];

  for (const [method, path] of cases) {
    const res = await request(app)[method](path)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    assert.equal(res.status, 403, `${method.toUpperCase()} ${path} must return 403`);
  }

  // Nothing was touched.
  assert.ok(await Client.findById(clientA._id));
  assert.ok(await Invoice.findById(invoiceA._id));
  assert.ok(await Quotation.findById(quotationA._id));
  assert.ok(await DocumentTemplate.findById(templateA._id));
});

test("Fix 4: delete filters are scoped by companyId at the database level", async () => {
  const deletedQuotation = await Quotation.findOneAndDelete({
    _id: quotationB._id,
    companyId: companyA._id,
  });
  assert.equal(deletedQuotation, null);
  assert.ok(await Quotation.exists({ _id: quotationB._id, companyId: companyB._id }));

  const deletedTemplate = await DocumentTemplate.findOneAndDelete({
    _id: templateB._id,
    companyId: companyA._id,
  });
  assert.equal(deletedTemplate, null);
  assert.ok(
    await DocumentTemplate.exists({ _id: templateB._id, companyId: companyB._id })
  );
});

test("company settings ignore a forged X-Company-Id and stay bound to the caller", async () => {
  const read = await request(app)
    .get("/api/company")
    .set("Authorization", `Bearer ${tokenA}`)
    .set("X-Company-Id", String(companyB._id));
  assert.equal(read.status, 200);
  assert.equal(read.body.code, "ALPHA");

  const write = await request(app)
    .put("/api/company")
    .set("Authorization", `Bearer ${tokenA}`)
    .set("X-Company-Id", String(companyB._id))
    .send({ tagline: "Alpha settings only" });
  assert.equal(write.status, 200);
  assert.equal(write.body.code, "ALPHA");
  assert.equal(write.body.tagline, "Alpha settings only");

  const companyBAfter = await Company.findById(companyB._id);
  assert.notEqual(companyBAfter.tagline, "Alpha settings only");
});

test("company A cannot read company B's company record", async () => {
  const res = await request(app)
    .get(`/api/companies/${companyB._id}`)
    .set("Authorization", `Bearer ${tokenA}`);
  assert.equal(res.status, 403);
  assert.match(res.body.message, /own company/i);
});
