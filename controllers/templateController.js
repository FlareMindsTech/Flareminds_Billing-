import mongoose from "mongoose";
import DocumentTemplate from "../models/DocumentTemplate.js";
import Company from "../models/Company.js";
import { audit } from "../utils/auditLog.js";
import { normalizeTemplatePayload } from "../utils/templateValidation.js";
import {
  ensureDefaultTemplates,
  resolveTemplate,
  templateSnapshot,
} from "../services/templateService.js";
import {
  PRESET_META,
  buildDefaultTemplateConfig,
} from "../services/templatePresets.js";
import {
  renderDynamicDocumentHTML,
  buildSampleDocument,
  shouldUseExternalFooter,
} from "../templates/dynamicRenderer.js";
import { renderHtmlToPdf } from "../services/pdfService.js";

const isBadId = (id) => !mongoose.isValidObjectId(id);
const MAX_TEMPLATES_PER_TYPE = 25;

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function companyIdFrom(req) {
  return req.companyId || req.admin?.companyId || null;
}

function slugCode(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function nameExists(companyId, docType, name, excludeId = null) {
  const filter = {
    companyId,
    docType,
    name: { $regex: `^${escapeRegExp(name)}$`, $options: "i" },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Boolean(await DocumentTemplate.exists(filter));
}

export const listTemplates = async (req, res) => {
  const companyId = companyIdFrom(req);
  if (!companyId) {
    return res.status(403).json({ message: "No company is selected" });
  }

  const docType = req.query.docType;
  if (docType && !["quotation", "invoice"].includes(docType)) {
    return res.status(400).json({ message: "Invalid document type" });
  }

  await ensureDefaultTemplates(companyId);

  const filter = { companyId };
  if (docType) filter.docType = docType;

  const templates = await DocumentTemplate.find(filter).sort({
    isDefault: -1,
    createdAt: 1,
  });

  res.json(templates);
};

export const getTemplate = async (req, res) => {
  const companyId = companyIdFrom(req);
  if (!companyId) return res.status(403).json({ message: "No company is selected" });
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Template not found" });
  }

  const template = await DocumentTemplate.findOne({
    _id: req.params.id,
    companyId,
  });
  if (!template) return res.status(404).json({ message: "Template not found" });
  res.json(template);
};

export const createTemplate = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) return res.status(403).json({ message: "No company is selected" });

    const { data, error } = normalizeTemplatePayload(req.body || {});
    if (error) return res.status(400).json({ message: error });

    const count = await DocumentTemplate.countDocuments({
      companyId,
      docType: data.docType,
    });
    if (count >= MAX_TEMPLATES_PER_TYPE) {
      return res.status(409).json({
        message: `A company can have at most ${MAX_TEMPLATES_PER_TYPE} ${data.docType} templates`,
      });
    }

    if (await nameExists(companyId, data.docType, data.name)) {
      return res.status(409).json({ message: "A template with this name already exists" });
    }

    const shouldBeDefault =
      data.isDefault || count === 0 || !(await DocumentTemplate.exists({ companyId, docType: data.docType, isDefault: true }));

    if (shouldBeDefault) {
      await DocumentTemplate.updateMany(
        { companyId, docType: data.docType },
        { $set: { isDefault: false } }
      );
    }

    const template = await DocumentTemplate.create({
      ...data,
      companyId,
      code: data.code || slugCode(data.name),
      isActive: Boolean(shouldBeDefault) ? true : data.isActive !== false,
      isDefault: Boolean(shouldBeDefault),
      createdBy: req.admin?.id || null,
      updatedBy: req.admin?.id || null,
    });

    audit("template_created", {
      actor: req.admin?.email,
      companyId: String(companyId),
      templateId: String(template._id),
      docType: template.docType,
      name: template.name,
    });

    res.status(201).json(template);
  } catch (err) {
    const duplicate = err?.code === 11000;
    res.status(duplicate ? 409 : 500).json({
      message: duplicate
        ? "A default template already exists for this document type"
        : "Failed to create template",
    });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) return res.status(403).json({ message: "No company is selected" });
    if (isBadId(req.params.id)) {
      return res.status(404).json({ message: "Template not found" });
    }

    const template = await DocumentTemplate.findOne({
      _id: req.params.id,
      companyId,
    });
    if (!template) return res.status(404).json({ message: "Template not found" });

    const existing = template.toObject();
    const body = req.body || {};

    const merged = {
      ...existing,
      ...body,
      docType: existing.docType,
      layout: { ...(existing.layout || {}), ...(body.layout || {}) },
      columns: { ...(existing.columns || {}), ...(body.columns || {}) },
      labels: { ...(existing.labels || {}), ...(body.labels || {}) },
      content: { ...(existing.content || {}), ...(body.content || {}) },
      sections: body.sections !== undefined ? body.sections : existing.sections,
      customFields:
        body.customFields !== undefined ? body.customFields : existing.customFields,
      itemCustomFields:
        body.itemCustomFields !== undefined
          ? body.itemCustomFields
          : existing.itemCustomFields,
    };

    const { data, error } = normalizeTemplatePayload(merged);
    if (error) return res.status(400).json({ message: error });

    if (body.isActive === false && (template.isDefault || data.isDefault === true)) {
      return res.status(409).json({
        message: "Choose another default template before deactivating this one",
      });
    }

    if (data.name !== template.name) {
      if (await nameExists(companyId, template.docType, data.name, template._id)) {
        return res.status(409).json({ message: "A template with this name already exists" });
      }
    }

    if (data.isDefault) {
      await DocumentTemplate.updateMany(
        { companyId, docType: template.docType, _id: { $ne: template._id } },
        { $set: { isDefault: false } }
      );
    } else if (body.isDefault === false && template.isDefault) {
      return res.status(409).json({
        message: "Choose another default template before clearing this one",
      });
    }

    template.name = data.name;
    template.code = data.code || template.code || slugCode(data.name);
    template.description = data.description || "";
    template.layout = data.layout;
    template.sections = data.sections;
    template.columns = data.columns;
    template.customFields = data.customFields;
    template.itemCustomFields = data.itemCustomFields;
    template.labels = data.labels;
    template.content = data.content;
    if (data.isActive !== undefined) template.isActive = data.isActive;
    if (data.isDefault !== undefined) template.isDefault = data.isDefault;
    template.version = (template.version || 1) + 1;
    template.updatedBy = req.admin?.id || null;

    await template.save();

    audit("template_updated", {
      actor: req.admin?.email,
      companyId: String(companyId),
      templateId: String(template._id),
      docType: template.docType,
      name: template.name,
    });

    res.json(template);
  } catch (err) {
    const duplicate = err?.code === 11000;
    res.status(duplicate ? 409 : 500).json({
      message: duplicate
        ? "A default template already exists for this document type"
        : "Failed to update template",
    });
  }
};

export const setDefaultTemplate = async (req, res) => {
  const companyId = companyIdFrom(req);
  if (!companyId) return res.status(403).json({ message: "No company is selected" });
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Template not found" });
  }

  const template = await DocumentTemplate.findOne({
    _id: req.params.id,
    companyId,
  });
  if (!template) return res.status(404).json({ message: "Template not found" });
  if (template.isActive === false) {
    return res.status(409).json({ message: "Activate the template before making it default" });
  }

  if (!template.isDefault) {
    await DocumentTemplate.updateMany(
      { companyId, docType: template.docType, _id: { $ne: template._id } },
      { $set: { isDefault: false } }
    );
    template.isDefault = true;
    await template.save();
  }

  audit("template_set_default", {
    actor: req.admin?.email,
    companyId: String(companyId),
    templateId: String(template._id),
    docType: template.docType,
  });

  res.json(template);
};

export const cloneTemplate = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) return res.status(403).json({ message: "No company is selected" });
    if (isBadId(req.params.id)) {
      return res.status(404).json({ message: "Template not found" });
    }

    const source = await DocumentTemplate.findOne({
      _id: req.params.id,
      companyId,
    });
    if (!source) return res.status(404).json({ message: "Template not found" });

    const count = await DocumentTemplate.countDocuments({
      companyId,
      docType: source.docType,
    });
    if (count >= MAX_TEMPLATES_PER_TYPE) {
      return res.status(409).json({ message: "Template limit reached" });
    }

    const raw = source.toObject();
    const baseName = `${source.name} Copy`;
    let name = baseName;
    let suffix = 2;
    while (await nameExists(companyId, source.docType, name)) {
      name = `${baseName} ${suffix}`;
      suffix += 1;
    }

    const clone = await DocumentTemplate.create({
      ...raw,
      _id: undefined,
      name,
      code: slugCode(name),
      isDefault: false,
      version: 1,
      createdBy: req.admin?.id || null,
      updatedBy: req.admin?.id || null,
      createdAt: undefined,
      updatedAt: undefined,
    });

    audit("template_cloned", {
      actor: req.admin?.email,
      companyId: String(companyId),
      sourceTemplateId: String(source._id),
      templateId: String(clone._id),
    });

    res.status(201).json(clone);
  } catch {
    res.status(500).json({ message: "Failed to clone template" });
  }
};

export const deleteTemplate = async (req, res) => {
  const companyId = companyIdFrom(req);
  if (!companyId) return res.status(403).json({ message: "No company is selected" });
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Template not found" });
  }

  const template = await DocumentTemplate.findOne({
    _id: req.params.id,
    companyId,
  });
  if (!template) return res.status(404).json({ message: "Template not found" });

  if (template.isDefault) {
    return res.status(409).json({
      message: "Choose another default template before deleting this one",
    });
  }

  await DocumentTemplate.findOneAndDelete({ _id: template._id, companyId });

  audit("template_deleted", {
    actor: req.admin?.email,
    companyId: String(companyId),
    templateId: String(template._id),
    docType: template.docType,
    name: template.name,
  });

  res.json({ message: "Template deleted" });
};

export const getTemplatePresets = async (req, res) => {
  const docType = req.query.docType === "invoice" ? "invoice" : "quotation";
  const presets = PRESET_META.filter(
    (preset) => !preset.legacy && preset.docTypes.includes(docType)
  );
  res.json({
    presets,
    templates: presets.map((preset) => ({
      ...preset,
      config: buildDefaultTemplateConfig(docType, {
        name: `${preset.name} ${docType === "invoice" ? "Invoice" : "Quotation"}`,
        preset: preset.key,
      }),
    })),
  });
};

export const previewTemplate = async (req, res) => {
  try {
    const companyId = companyIdFrom(req);
    if (!companyId) return res.status(403).json({ message: "No company is selected" });

    const company = await Company.findById(companyId);
    if (!company) return res.status(404).json({ message: "Company not found" });

    const templateInput = req.body?.template || req.body || {};
    const docType = req.body?.docType === "invoice" ? "invoice" : templateInput.docType === "invoice" ? "invoice" : "quotation";
    const normalizedInput = { ...templateInput, docType };
    if (!normalizedInput.name) normalizedInput.name = "Preview Template";

    const { data, error } = normalizeTemplatePayload(normalizedInput);
    if (error) return res.status(400).json({ message: error });

    const sample = buildSampleDocument(docType, company, data);
    const overrides = req.body?.document || {};
    const doc = {
      ...sample,
      ...overrides,
      customFields: {
        ...(sample.customFields || {}),
        ...(overrides.customFields || {}),
      },
      lineItems: Array.isArray(overrides.lineItems)
        ? overrides.lineItems
        : (sample.lineItems || []).map((item, index) => ({
            ...item,
            customFields: {
              ...(item.customFields || {}),
              ...((overrides.lineItems || [])[index]?.customFields || {}),
            },
          })),
    };

    const html = await renderDynamicDocumentHTML({
      docType,
      doc,
      client: doc.clientSnapshot || doc.client || {},
      company,
      template: data,
    });

    if (req.query.format === "pdf") {
      const pdf = await renderHtmlToPdf(html, {
        footerHtml:
          data.layout?.showPageNumbers === false || !shouldUseExternalFooter(data)
            ? undefined
            : `<div style="width:100%;padding:0 14mm;font-family:Arial,sans-serif;font-size:8px;color:#64748b;display:flex;justify-content:space-between;"><span>${company.name || ""}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      });
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="template-preview.pdf"',
      });
      return res.end(Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf));
    }

    res.json({ html });
  } catch (err) {
    res.status(500).json({
      message: "Failed to render template preview",
      ...(process.env.NODE_ENV !== "production" ? { error: err.message } : {}),
    });
  }
};

// Used by invoice/quotation creation to freeze the exact merged config.
export async function snapshotForDocument(company, docType, templateId = null) {
  const template = await resolveTemplate(company._id, docType, templateId);
  if (!template) return { templateId: null, templateSnapshot: null };
  return {
    templateId: template._id || null,
    templateSnapshot: templateSnapshot(template, company),
  };
}
