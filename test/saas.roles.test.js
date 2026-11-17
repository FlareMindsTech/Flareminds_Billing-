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
const { signAccessToken } = await import("../utils/token.js");
const { closePdfBrowser } = await import("../services/pdfService.js");
const { app } = await import("../server.js");

let mongod;
let superToken;
let alpha;
let beta;
let alphaToken;
let betaToken;

const isoDay = (offset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const login = (email, password) =>
  request(app).post("/api/auth/login").send({ email, password });

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([
    Admin.syncIndexes(),
    Client.syncIndexes(),
    Company.syncIndexes(),
    DocumentTemplate.syncIndexes(),
    Invoice.syncIndexes(),
  ]);

  const superadmin = await Admin.create({
    email: "owner@platform.test",
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

test("superadmin provisions a company with exactly one admin and default templates", async () => {
  const alphaRes = await request(app)
    .post("/api/admin/companies")
    .set("Authorization", `Bearer ${superToken}`)
    .send({
      name: "Alpha Industries",
      code: "ALPHA",
      admin: {
        email: "alpha-admin@example.com",
        password: "AlphaPassword@123",
        name: "Alpha Admin",
      },
    });

  assert.equal(alphaRes.status, 201, JSON.stringify(alphaRes.body));
  alpha = alphaRes.body.company;
  assert.equal(alphaRes.body.admin.email, "alpha-admin@example.com");

  const betaRes = await request(app)
    .post("/api/admin/companies")
    .set("Authorization", `Bearer ${superToken}`)
    .send({
      name: "Beta Services",
      code: "BETA",
      admin: {
        email: "beta-admin@example.com",
        password: "BetaPassword@123",
        name: "Beta Admin",
      },
    });

  assert.equal(betaRes.status, 201, JSON.stringify(betaRes.body));
  beta = betaRes.body.company;

  const admins = await Admin.find({ role: "company_admin" }).lean();
  assert.equal(admins.length, 2);
  assert.ok(admins.every((admin) => admin.companyId));

  const alphaTemplates = await DocumentTemplate.find({ companyId: alpha._id }).lean();
  assert.equal(alphaTemplates.length, 2);
  assert.deepEqual(
    alphaTemplates.map((template) => template.docType).sort(),
    ["invoice", "quotation"]
  );
  assert.ok(alphaTemplates.every((template) => template.isDefault));
});

test("company admin login is locked to its own company", async () => {
  const res = await login("alpha-admin@example.com", "AlphaPassword@123");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.admin.role, "company_admin");
  assert.equal(String(res.body.admin.companyId), String(alpha._id));
  alphaToken = res.body.token;

  const betaLogin = await login("beta-admin@example.com", "BetaPassword@123");
  assert.equal(betaLogin.status, 200);
  betaToken = betaLogin.body.token;

  const own = await request(app)
    .get("/api/company")
    .set("Authorization", `Bearer ${alphaToken}`);
  assert.equal(own.status, 200);
  assert.equal(own.body.code, "ALPHA");

  const crossTenant = await request(app)
    .get("/api/invoices")
    .set("Authorization", `Bearer ${alphaToken}`)
    .set("X-Company-Id", String(beta._id));
  assert.equal(crossTenant.status, 403);
  assert.match(crossTenant.body.message, /own company/i);
});

test("company admins cannot use superadmin-only company APIs", async () => {
  const list = await request(app)
    .get("/api/admin/companies")
    .set("Authorization", `Bearer ${alphaToken}`);
  assert.equal(list.status, 403);
  assert.match(list.body.message, /superadmin/i);

  const create = await request(app)
    .post("/api/admin/companies")
    .set("Authorization", `Bearer ${alphaToken}`)
    .send({ name: "Rogue Co", admin: { email: "rogue@example.com", password: "RoguePassword@123" } });
  assert.equal(create.status, 403);

  const suspendBeta = await request(app)
    .patch(`/api/admin/companies/${beta._id}/status`)
    .set("Authorization", `Bearer ${alphaToken}`)
    .send({ status: "suspended" });
  assert.equal(suspendBeta.status, 403);
});

test("company templates can be customised and documents freeze the snapshot", async () => {
  const list = await request(app)
    .get("/api/templates")
    .query({ docType: "invoice" })
    .set("Authorization", `Bearer ${alphaToken}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.ok(list.body[0].isDefault);

  const presets = await request(app)
    .get("/api/templates/presets")
    .query({ docType: "invoice" })
    .set("Authorization", `Bearer ${alphaToken}`);
  assert.equal(presets.status, 200);
  const config = presets.body.templates[0].config;
  assert.ok(config);

  const created = await request(app)
    .post("/api/templates")
    .set("Authorization", `Bearer ${alphaToken}`)
    .send({
      ...config,
      name: "Branded Invoice",
      isDefault: false,
      layout: { ...config.layout, accentColor: "#0ea5e9", preset: "modern" },
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const templateId = created.body._id;
  assert.equal(created.body.isDefault, false);

  const madeDefault = await request(app)
    .post(`/api/templates/${templateId}/default`)
    .set("Authorization", `Bearer ${alphaToken}`);
  assert.equal(madeDefault.status, 200);
  assert.equal(madeDefault.body.isDefault, true);

  const client = await Client.create({
    name: "Alpha Client",
    companyId: alpha._id,
  });

  const invoiceRes = await request(app)
    .post("/api/invoices")
    .set("Authorization", `Bearer ${alphaToken}`)
    .send({
      client: client._id,
      date: isoDay(0),
      dueDate: isoDay(15),
      taxPercent: 18,
      lineItems: [
        {
          description: "Consulting engagement",
          category: "development",
          quantity: 2,
          rate: 5000,
        },
      ],
      templateId,
    });

  assert.equal(invoiceRes.status, 201, JSON.stringify(invoiceRes.body));
  assert.equal(String(invoiceRes.body.templateId), String(templateId));
  assert.equal(invoiceRes.body.templateSnapshot.name, "Branded Invoice");
  assert.equal(invoiceRes.body.templateSnapshot.layout.accentColor, "#0ea5e9");

  const updated = await request(app)
    .put(`/api/templates/${templateId}`)
    .set("Authorization", `Bearer ${alphaToken}`)
    .send({ name: "Branded Invoice v2" });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.version, 2);

  const invoiceAfter = await request(app)
    .get(`/api/invoices/${invoiceRes.body._id}`)
    .set("Authorization", `Bearer ${alphaToken}`);
  assert.equal(invoiceAfter.status, 200);
  assert.equal(invoiceAfter.body.templateSnapshot.name, "Branded Invoice");

  const stored = await Invoice.findById(invoiceRes.body._id).lean();
  assert.equal(stored.templateSnapshot.name, "Branded Invoice");

  const pdf = await request(app)
    .get(`/api/invoices/${invoiceRes.body._id}/pdf`)
    .set("Authorization", `Bearer ${alphaToken}`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers["content-type"], "application/pdf");
  assert.ok(pdf.body.length > 1000);
});

test("suspending a company locks out logins and existing tenant sessions", async () => {
  const suspended = await request(app)
    .patch(`/api/admin/companies/${beta._id}/status`)
    .set("Authorization", `Bearer ${superToken}`)
    .send({ status: "suspended", reason: "Payment overdue" });
  assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
  assert.equal(suspended.body.status, "suspended");

  const blockedLogin = await login("beta-admin@example.com", "BetaPassword@123");
  assert.equal(blockedLogin.status, 403);
  assert.equal(blockedLogin.body.code, "COMPANY_SUSPENDED");
  assert.match(blockedLogin.body.message, /Payment overdue/);

  const blockedRequest = await request(app)
    .get("/api/invoices")
    .set("Authorization", `Bearer ${betaToken}`);
  assert.equal(blockedRequest.status, 403);
  assert.equal(blockedRequest.body.code, "COMPANY_SUSPENDED");

  const blockedSettings = await request(app)
    .get("/api/company")
    .set("Authorization", `Bearer ${betaToken}`);
  assert.equal(blockedSettings.status, 403);
  assert.equal(blockedSettings.body.code, "COMPANY_SUSPENDED");
});

test("superadmin can reactivate a company and reset its admin password", async () => {
  const activated = await request(app)
    .patch(`/api/admin/companies/${beta._id}/status`)
    .set("Authorization", `Bearer ${superToken}`)
    .send({ status: "active" });
  assert.equal(activated.status, 200);
  assert.equal(activated.body.status, "active");

  const reset = await request(app)
    .patch(`/api/admin/companies/${beta._id}/admin/password`)
    .set("Authorization", `Bearer ${superToken}`)
    .send({ password: "BetaPassword@456" });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));

  const oldPassword = await login("beta-admin@example.com", "BetaPassword@123");
  assert.equal(oldPassword.status, 401);

  const newPassword = await login("beta-admin@example.com", "BetaPassword@456");
  assert.equal(newPassword.status, 200, JSON.stringify(newPassword.body));
  assert.equal(newPassword.body.admin.role, "company_admin");
  assert.equal(String(newPassword.body.admin.companyId), String(beta._id));
});


test("company admins cannot access other tenants quotations or templates via X-Company-Id", async () => {
  const crossQtn = await request(app)
    .get("/api/quotations")
    .set("Authorization", `Bearer ${alphaToken}`)
    .set("X-Company-Id", String(beta._id));
  assert.equal(crossQtn.status, 403);
  assert.match(crossQtn.body.message, /own company/i);

  const crossTpl = await request(app)
    .get("/api/templates")
    .set("Authorization", `Bearer ${alphaToken}`)
    .set("X-Company-Id", String(beta._id));
  assert.equal(crossTpl.status, 403);
  assert.match(crossTpl.body.message, /own company/i);
});
