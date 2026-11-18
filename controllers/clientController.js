import mongoose from "mongoose";
import Client from "../models/Client.js";
import Invoice from "../models/Invoice.js";
import Quotation from "../models/Quotation.js";
import { audit } from "../utils/auditLog.js";
import { isValidEmail } from "../utils/validation.js";
import { stateCodeForName } from "../utils/indianStates.js";
import { resolveStateCode, normalizeGstin } from "../utils/gst.js";

const CLIENT_FIELDS = [
  "name",
  "company",
  "address",
  "email",
  "whatsapp",
  "phone",
  "gstn",
  "state",
  "stateCode",
  "notes",
  "isActive",
];

const isBadId = (id) => !mongoose.isValidObjectId(id);

const tenantId = (req) => req.companyId || req.company?._id || req.admin?.companyId || null;

// Prevents clients from writing arbitrary fields (including _id/timestamps).
function pickClientFields(body = {}) {
  const data = {};
  for (const field of CLIENT_FIELDS) {
    if (body[field] !== undefined) data[field] = body[field];
  }
  return data;
}

function validateClient(data, { requireName = false } = {}) {
  if (data.name !== undefined) {
    if (typeof data.name !== "string") return "Name must be a string.";
    if (!data.name.trim()) return "Name is required.";
    if (data.name.trim().length < 2) return "Name must be at least 2 characters.";
  } else if (requireName) {
    return "Name is required.";
  }

  if (data.email !== undefined && data.email !== "") {
    if (!isValidEmail(data.email)) return "Enter a valid email address.";
  }

  if (data.isActive !== undefined && typeof data.isActive !== "boolean") {
    return "isActive must be a boolean.";
  }

  if (data.state !== undefined || data.stateCode !== undefined) {
    const state = (data.state ?? "").trim();
    const code = (data.stateCode ?? "").trim().toUpperCase();
    if (code && !/^[0-9]{2}$/.test(code)) {
      return "GST state code must be 2 digits.";
    }
    if (state && code) {
      const expected = stateCodeForName(state);
      if (expected && expected !== code) {
        return "State and GST state code do not match.";
      }
    }
    if (state && !code) {
      const expected = stateCodeForName(state);
      if (expected) data.stateCode = expected;
    }
  }

  if (data.gstn !== undefined && !data.stateCode) {
    const normalized = normalizeGstin(data.gstn);
    if (normalized) {
      const derived = resolveStateCode({ gstn: normalized });
      if (derived) data.stateCode = derived;
    }
  }

  return null;
}

export const listClients = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }

  const clients = await Client.find({ companyId }).sort({ createdAt: -1 });
  res.json(clients);
};

export const getClient = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Client not found" });
  }

  const client = await Client.findOne({ _id: req.params.id, companyId });
  if (!client) return res.status(404).json({ message: "Client not found" });
  res.json(client);
};

export const createClient = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }

  const data = pickClientFields(req.body);
  const validationError = validateClient(data, { requireName: true });

  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  data.companyId = companyId;

  try {
    const client = await Client.create(data);
    audit("client_created", {
      actor: req.admin?.email,
      clientId: String(client._id),
    });

    res.status(201).json(client);
  } catch (err) {
    const status = err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      message: status === 400 ? err.message : "Failed to create client",
    });
  }
};

export const updateClient = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Client not found" });
  }

  const data = pickClientFields(req.body);
  const validationError = validateClient(data);

  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  try {
    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, companyId },
      data,
      { new: true, runValidators: true }
    );

    if (!client) return res.status(404).json({ message: "Client not found" });

    audit("client_updated", {
      actor: req.admin?.email,
      clientId: String(client._id),
      fields: Object.keys(data),
    });

    res.json(client);
  } catch (err) {
    const status = err.name === "ValidationError" ? 400 : 500;
    res.status(status).json({
      message: status === 400 ? err.message : "Failed to update client",
    });
  }
};

export const deleteClient = async (req, res) => {
  const companyId = tenantId(req);
  if (!companyId) {
    return res.status(409).json({ message: "No active company is configured" });
  }
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Client not found" });
  }

  const existing = await Client.findOne({ _id: req.params.id, companyId });
  if (!existing) return res.status(404).json({ message: "Client not found" });

  // Refuse to orphan existing invoices or quotations.
  const invoiceCount = await Invoice.countDocuments({
    client: req.params.id,
    companyId,
  });
  if (invoiceCount > 0) {
    return res.status(409).json({
      message: `This client has ${invoiceCount} invoice(s). Delete or reassign them first.`,
    });
  }

  const quotationCount = await Quotation.countDocuments({
    client: req.params.id,
    companyId,
  });
  if (quotationCount > 0) {
    return res.status(409).json({
      message: `This client has ${quotationCount} quotation(s). Delete or reassign them first.`,
    });
  }

  const client = await Client.findOneAndDelete({ _id: req.params.id, companyId });

  if (!client) {
    return res.status(404).json({ message: "Client not found" });
  }

  audit("client_deleted", {
    actor: req.admin?.email,
    clientId: String(client._id),
  });

  res.json({ message: "Client deleted" });
};
