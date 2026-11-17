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
const { default: Company } = await import("../models/Company.js");
const { default: DocumentTemplate } = await import("../models/DocumentTemplate.js");
const { signAccessToken } = await import("../utils/token.js");
const { closePdfBrowser } = await import("../services/pdfService.js");
const { app } = await import("../server.js");

let mongod;
let superToken;
let alpha;
let beta;
let alphaToken;
let master;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([
    Admin.syncIndexes(),
    Company.syncIndexes(),
    DocumentTemplate.syncIndexes(),
  ]);

  const superadmin = await Admin.create({
    email: "owner@templates.test",
    passwordHash: await Admin.hashPassword("OwnerPassword@123"),
    name: "Platform Owner",
    role: "superadmin",
  });
  superToken = signAccessToken(superadmin);
});

after(async () => {
  await closePdfBrowser();
  await mongoose.disconnect();
  await mongod.stop();
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

test("superadmin template library seeds system designs and lists the catalog", async () => {
  const list = await request(app).get("/api/admin/templates").set(auth(superToken));
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.length >= 8);
  assert.ok(list.body.every((item) => item.companyId === null && item.isSystem === true));
  assert.ok(list.body.some((item) => item.layout?.preset === "gst-invoice"));
  assert.ok(list.body.some((item) => item.layout?.preset === "commercial-proposal"));

  const catalog = await request(app)
    .get("/api/admin/templates/catalog?docType=invoice")
    .set(auth(superToken));
  assert.equal(catalog.status, 200);
  const keys = catalog.body.presets.map((preset) => preset.key);
  assert.deepEqual(
    keys.filter((key) => ["gst-invoice", "premium-invoice", "service-invoice"].includes(key)).sort(),
    ["gst-invoice", "premium-invoice", "service-invoice"]
  );
  assert.ok(!keys.includes("tax-invoice"));
  assert.ok(!keys.includes("commercial-proposal"));

  const quoteCatalog = await request(app)
    .get("/api/admin/templates/catalog?docType=quotation")
    .set(auth(superToken));
  const quoteKeys = quoteCatalog.body.presets.map((preset) => preset.key);
  assert.ok(quoteKeys.includes("commercial-proposal"));
  assert.ok(quoteKeys.includes("minimal-quotation"));
  assert.ok(!quoteKeys.includes("proposal"));
});

test("company admins cannot reach the platform template library", async () => {
  const res = await request(app)
    .post("/api/admin/companies")
    .set(auth(superToken))
    .send({
      name: "Alpha Solar",
      code: "ALPHA",
      admin: {
        email: "alpha-admin@templates.test",
        password: "AlphaPassword@123",
        name: "Alpha Admin",
      },
    });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  alpha = res.body.company;

  const betaRes = await request(app)
    .post("/api/admin/companies")
    .set(auth(superToken))
    .send({
      name: "Beta Retail",
      code: "BETA",
      admin: {
        email: "beta-admin@templates.test",
        password: "BetaPassword@123",
        name: "Beta Admin",
      },
    });
  assert.equal(betaRes.status, 201, JSON.stringify(betaRes.body));
  beta = betaRes.body.company;

  const login = await request(app)
    .post("/api/auth/login")
    .send({ email: "alpha-admin@templates.test", password: "AlphaPassword@123" });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  alphaToken = login.body.token;

  const denied = await request(app).get("/api/admin/templates").set(auth(alphaToken));
  assert.equal(denied.status, 403);
});

test("superadmin can create, update and clone a system design", async () => {
  const created = await request(app)
    .post("/api/admin/templates")
    .set(auth(superToken))
    .send({
      name: "Platform GST Invoice",
      docType: "invoice",
      preset: "gst-invoice",
      description: "Default GST invoice for new companies",
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  master = created.body;
  assert.equal(master.companyId, null);
  assert.equal(master.isSystem, true);
  assert.equal(master.isDefault, false);
  assert.equal(master.layout.preset, "gst-invoice");
  assert.ok(master.content);

  const updated = await request(app)
    .put(`/api/admin/templates/${master._id}`)
    .set(auth(superToken))
    .send({ name: "Platform GST Invoice v2", content: { noticeText: "Platform notice" } });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  master = updated.body;
  assert.equal(master.name, "Platform GST Invoice v2");
  assert.equal(master.content.noticeText, "Platform notice");
  assert.equal(master.version, 2);

  const cloned = await request(app)
    .post(`/api/admin/templates/${master._id}/clone`)
    .set(auth(superToken));
  assert.equal(cloned.status, 201, JSON.stringify(cloned.body));
  assert.notEqual(cloned.body._id, master._id);
  assert.equal(cloned.body.companyId, null);
  assert.equal(cloned.body.isSystem, true);
  assert.match(cloned.body.name, /Copy$/);
  assert.equal(String(cloned.body.sourceSystemTemplateId), String(master._id));

  const invalidPreset = await request(app)
    .put(`/api/admin/templates/${master._id}`)
    .set(auth(superToken))
    .send({ layout: { preset: "commercial-proposal" } });
  assert.equal(invalidPreset.status, 400);
});

test("assigning a design creates independent company copies and skips duplicates", async () => {
  const assigned = await request(app)
    .post(`/api/admin/templates/${master._id}/assign`)
    .set(auth(superToken))
    .send({ companyIds: [String(alpha._id), String(beta._id)], makeDefault: true });
  assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.body.assigned.length, 2);
  assert.equal(assigned.body.skipped.length, 0);

  const alphaCopies = await DocumentTemplate.find({
    companyId: alpha._id,
    sourceSystemTemplateId: master._id,
  });
  const betaCopies = await DocumentTemplate.find({
    companyId: beta._id,
    sourceSystemTemplateId: master._id,
  });
  assert.equal(alphaCopies.length, 1);
  assert.equal(betaCopies.length, 1);
  assert.notEqual(String(alphaCopies[0]._id), String(betaCopies[0]._id));
  assert.equal(alphaCopies[0].isSystem, false);
  assert.equal(alphaCopies[0].isDefault, true);
  assert.equal(alphaCopies[0].content.noticeText, "Platform notice");

  const again = await request(app)
    .post(`/api/admin/templates/${master._id}/assign`)
    .set(auth(superToken))
    .send({ companyIds: [String(alpha._id)] });
  assert.equal(again.status, 200);
  assert.equal(again.body.assigned.length, 0);
  assert.equal(again.body.skipped[0].reason, "already-assigned");

  const assignments = await request(app)
    .get(`/api/admin/templates/${master._id}/assignments`)
    .set(auth(superToken));
  assert.equal(assignments.status, 200);
  assert.equal(assignments.body.assignments.length, 2);

  const masterUpdate = await request(app)
    .put(`/api/admin/templates/${master._id}`)
    .set(auth(superToken))
    .send({ name: "Platform GST Invoice v3" });
  assert.equal(masterUpdate.status, 200);
  master = masterUpdate.body;

  const alphaCopy = await DocumentTemplate.findById(alphaCopies[0]._id);
  assert.equal(alphaCopy.name, alphaCopies[0].name);
  assert.notEqual(alphaCopy.name, master.name);

  const tenantTemplates = await request(app)
    .get("/api/templates?docType=invoice")
    .set(auth(alphaToken));
  assert.equal(tenantTemplates.status, 200, JSON.stringify(tenantTemplates.body));
  const tenantList = tenantTemplates.body.templates || tenantTemplates.body;
  assert.ok(tenantList.some((item) => String(item._id) === String(alphaCopy._id)));

  const tenantUpdate = await request(app)
    .put(`/api/templates/${alphaCopy._id}`)
    .set(auth(alphaToken))
    .send({ name: "Alpha Custom GST Invoice" });
  assert.equal(tenantUpdate.status, 200, JSON.stringify(tenantUpdate.body));
  assert.equal(tenantUpdate.body.name, "Alpha Custom GST Invoice");

  const masterAfterTenantEdit = await DocumentTemplate.findById(master._id);
  assert.equal(masterAfterTenantEdit.name, "Platform GST Invoice v3");

  const unassignDefault = await request(app)
    .delete(`/api/admin/templates/${master._id}/assignments`)
    .set(auth(superToken))
    .send({ companyId: String(alpha._id) });
  assert.equal(unassignDefault.status, 409);
});

test("design previews render the GST invoice and three-page proposal content", async () => {
  const catalog = await request(app)
    .get("/api/admin/templates/catalog?docType=invoice")
    .set(auth(superToken));
  const gst = catalog.body.presets.find((preset) => preset.key === "gst-invoice");

  const invoicePreview = await request(app)
    .post("/api/admin/templates/preview")
    .set(auth(superToken))
    .send({ docType: "invoice", template: { ...gst.config, docType: "invoice", name: "GST Preview" } });
  assert.equal(invoicePreview.status, 200, JSON.stringify(invoicePreview.body));
  assert.match(invoicePreview.body.html, /TAX INVOICE/i);
  assert.match(invoicePreview.body.html, /Bank Details/i);
  assert.match(invoicePreview.body.html, /Amount in Words/i);

  const quoteCatalog = await request(app)
    .get("/api/admin/templates/catalog?docType=quotation")
    .set(auth(superToken));
  const proposal = quoteCatalog.body.presets.find(
    (preset) => preset.key === "commercial-proposal"
  );

  const proposalPreview = await request(app)
    .post("/api/admin/templates/preview")
    .set(auth(superToken))
    .send({
      docType: "quotation",
      template: { ...proposal.config, docType: "quotation", name: "Proposal Preview" },
    });
  assert.equal(proposalPreview.status, 200, JSON.stringify(proposalPreview.body));
  assert.match(proposalPreview.body.html, /COMMERCIAL PROPOSAL/i);
  assert.match(proposalPreview.body.html, /Scope of Work Details/i);
  assert.match(proposalPreview.body.html, /Installation Process/i);
  assert.match(proposalPreview.body.html, /Payment Milestones/i);

  for (const preset of catalog.body.presets.filter((item) =>
    ["premium-invoice", "service-invoice"].includes(item.key)
  )) {
    const preview = await request(app)
      .post("/api/admin/templates/preview")
      .set(auth(superToken))
      .send({
        docType: "invoice",
        template: { ...preset.config, docType: "invoice", name: `${preset.name} Preview` },
      });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.ok(preview.body.html.length > 1000);
  }

  const minimal = quoteCatalog.body.presets.find(
    (preset) => preset.key === "minimal-quotation"
  );
  const minimalPreview = await request(app)
    .post("/api/admin/templates/preview")
    .set(auth(superToken))
    .send({
      docType: "quotation",
      template: { ...minimal.config, docType: "quotation", name: "Minimal Preview" },
    });
  assert.equal(minimalPreview.status, 200, JSON.stringify(minimalPreview.body));
  assert.ok(minimalPreview.body.html.length > 1000);
});

test("GST invoice renders one page and the commercial proposal renders exactly three", async () => {
  const invoiceCatalog = await request(app)
    .get("/api/admin/templates/catalog?docType=invoice")
    .set(auth(superToken));
  const gst = invoiceCatalog.body.presets.find((preset) => preset.key === "gst-invoice");

  const invoicePdf = await request(app)
    .post("/api/admin/templates/preview?format=pdf")
    .set(auth(superToken))
    .send({ docType: "invoice", template: { ...gst.config, docType: "invoice", name: "GST Preview" } });
  assert.equal(invoicePdf.status, 200);
  assert.equal(invoicePdf.body.subarray(0, 5).toString(), "%PDF-");
  const invoicePages =
    invoicePdf.body.toString("latin1").match(/\/Type\s*\/Page\b/g) || [];
  assert.equal(invoicePages.length, 1, `expected 1 GST invoice page, got ${invoicePages.length}`);

  const quoteCatalog = await request(app)
    .get("/api/admin/templates/catalog?docType=quotation")
    .set(auth(superToken));
  const proposal = quoteCatalog.body.presets.find(
    (preset) => preset.key === "commercial-proposal"
  );

  const proposalPdf = await request(app)
    .post("/api/admin/templates/preview?format=pdf")
    .set(auth(superToken))
    .send({
      docType: "quotation",
      template: { ...proposal.config, docType: "quotation", name: "Proposal Preview" },
    });
  assert.equal(proposalPdf.status, 200);
  assert.equal(proposalPdf.body.subarray(0, 5).toString(), "%PDF-");
  const proposalPages =
    proposalPdf.body.toString("latin1").match(/\/Type\s*\/Page\b/g) || [];
  assert.equal(
    proposalPages.length,
    3,
    `expected exactly 3 commercial proposal pages, got ${proposalPages.length}`
  );
});
