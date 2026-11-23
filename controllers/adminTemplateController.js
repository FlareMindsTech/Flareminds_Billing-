import mongoose from "mongoose";
import DocumentTemplate from "../models/DocumentTemplate.js";
import Company from "../models/Company.js";
import { audit } from "../utils/auditLog.js";
import { normalizeTemplatePayload } from "../utils/templateValidation.js";
import {
  ensureSystemTemplates,
  assignSystemTemplate,
  MAX_TEMPLATES_PER_TYPE,
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
const SYSTEM_FILTER = { companyId: null, isSystem: true };
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const DEMO_COMPANY = {
  name: "Your Company",
  code: "DEMO",
  tagline: "Engineering clean energy solutions",
  address: "12 Business Park Road, Chennai, Tamil Nadu 600001",
  phone: "+91 98765 43210",
  email: "hello@yourcompany.com",
  website: "www.yourcompany.com",
  gstn: "33ABCDE1234F1Z5",
  currency: "INR",
  signatoryName: "Authorised Signatory",
  signatoryTitle: "Founder & CEO",
  bank: {
    bankName: "State Bank of India",
    accountName: "Your Company",
    accountNumber: "00000000000",
    ifsc: "SBIN0000000",
    branch: "Main Branch",
    upi: "yourcompany@upi",
  },
};

function slugCode(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function nameExists(docType, name, excludeId = null) {
  const filter = {
    ...SYSTEM_FILTER,
    docType,
    name: { $regex: `^${escapeRegExp(name)}$`, $options: "i" },
  };
  if (excludeId) filter._id = { $ne: excludeId };
  return Boolean(await DocumentTemplate.exists(filter));
}

async function uniqueSystemName(docType, baseName) {
  let name = baseName;
  let suffix = 2;
  while (await nameExists(docType, name)) {
    name = `${baseName} ${suffix}`;
    suffix += 1;
  }
  return name;
}

export const listSystemTemplates = async (req, res) => {
  try {
    await ensureSystemTemplates(req.admin?.id || null);

    const filter = { ...SYSTEM_FILTER };
    if (req.query.docType) {
      if (!["quotation", "invoice"].includes(req.query.docType)) {
        return res.status(400).json({ message: "Invalid document type" });
      }
      filter.docType = req.query.docType;
    }
    if (req.query.search) {
      filter.name = { $regex: escapeRegExp(req.query.search), $options: "i" };
    }

    const templates = await DocumentTemplate.find(filter).sort({
      docType: 1,
      createdAt: 1,
    });

    const counts = await DocumentTemplate.aggregate([
      {
        $match: {
          companyId: { $ne: null },
          sourceSystemTemplateId: {
            $in: templates.map((template) => template._id),
          },
        },
      },
      { $group: { _id: "$sourceSystemTemplateId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(
      counts.map((item) => [String(item._id), item.count])
    );

    res.json(
      templates.map((template) => ({
        ...template.toObject(),
        assignmentCount: countMap.get(String(template._id)) || 0,
      }))
    );
  } catch {
    res.status(500).json({ message: "Failed to load system templates" });
  }
};

export const getTemplateCatalog = async (req, res) => {
  try {
    const docType = req.query.docType;
    const presets = PRESET_META.filter(
      (preset) =>
        !preset.legacy &&
        (!docType || preset.docTypes.includes(docType))
    ).map((preset) => {
      const type = docType || preset.docTypes[0] || "quotation";
      return {
        ...preset,
        config: buildDefaultTemplateConfig(type, {
          name: preset.name,
          preset: preset.key,
        }),
      };
    });
    res.json({ presets });
  } catch {
    res.status(500).json({ message: "Failed to load template catalog" });
  }
};

export const getSystemTemplate = async (req, res) => {
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Template not found" });
  }
  const template = await DocumentTemplate.findOne({
    _id: req.params.id,
    ...SYSTEM_FILTER,
  });
  if (!template) return res.status(404).json({ message: "Template not found" });
  res.json(template);
};

export const createSystemTemplate = async (req, res) => {
  try {
    const body = req.body || {};
    const preset = PRESET_META.find(
      (item) => item.key === body.preset && !item.legacy
    );
    const docType =
      body.docType === "invoice"
        ? "invoice"
        : body.docType === "quotation"
          ? "quotation"
          : preset?.docTypes?.[0] || "quotation";

    if (!preset) {
      return res.status(400).json({ message: "Choose a valid design preset" });
    }
    if (!preset.docTypes.includes(docType)) {
      return res.status(400).json({
        message: `The ${preset.name} design is not available for ${docType}s`,
      });
    }

    const config = buildDefaultTemplateConfig(docType, {
      name: body.name || preset.name,
      preset: preset.key,
    });
    const merged = {
      ...config,
      ...body,
      docType,
      isDefault: false,
      isActive: body.isActive !== false,
    };
    if (body.layout) mergeNested(merged, config, body, "layout");
    if (body.labels) mergeNested(merged, config, body, "labels");
    if (body.columns) mergeNested(merged, config, body, "columns");
    if (body.content) mergeNested(merged, config, body, "content");

    if (await nameExists(docType, merged.name)) {
      return res.status(409).json({
        message: "A system template with this name already exists",
      });
    }

    const { data, error } = normalizeTemplatePayload(merged);
    if (error) return res.status(400).json({ message: error });

    const template = await DocumentTemplate.create({
      ...data,
      code: data.code || `SYS-${slugCode(data.name)}`,
      description: body.description || preset.description,
      companyId: null,
      isSystem: true,
      isDefault: false,
      createdBy: req.admin?.id || null,
      updatedBy: req.admin?.id || null,
    });

    audit("system_template_created", {
      actor: req.admin?.email,
      templateId: String(template._id),
      docType: template.docType,
      name: template.name,
    });

    res.status(201).json(template);
  } catch (err) {
    res.status(500).json({
      message: "Failed to create system template",
      ...(process.env.NODE_ENV !== "production" ? { error: err.message } : {}),
    });
  }
};

function mergeNested(target, config, body, key) {
  target[key] = {
    ...(config[key] || {}),
    ...(body[key] || {}),
  };
}

export const updateSystemTemplate = async (req, res) => {
  try {
    if (isBadId(req.params.id)) {
      return res.status(404).json({ message: "Template not found" });
    }
    const template = await DocumentTemplate.findOne({
      _id: req.params.id,
      ...SYSTEM_FILTER,
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

    const preset = PRESET_META.find((item) => item.key === data.layout?.preset);
    if (!preset || !preset.docTypes.includes(template.docType)) {
      return res.status(400).json({
        message: "Choose a design that is available for this document type",
      });
    }

    if (data.name !== template.name) {
      if (await nameExists(template.docType, data.name, template._id)) {
        return res.status(409).json({
          message: "A system template with this name already exists",
        });
      }
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
    template.isActive = data.isActive !== false;
    template.version = (template.version || 1) + 1;
    template.updatedBy = req.admin?.id || null;
    await template.save();

    audit("system_template_updated", {
      actor: req.admin?.email,
      templateId: String(template._id),
      docType: template.docType,
      name: template.name,
    });

    res.json(template);
  } catch {
    res.status(500).json({ message: "Failed to update system template" });
  }
};

export const cloneSystemTemplate = async (req, res) => {
  try {
    if (isBadId(req.params.id)) {
      return res.status(404).json({ message: "Template not found" });
    }
    const source = await DocumentTemplate.findOne({
      _id: req.params.id,
      ...SYSTEM_FILTER,
    });
    if (!source) return res.status(404).json({ message: "Template not found" });

    const name = await uniqueSystemName(source.docType, `${source.name} Copy`);
    const raw = source.toObject();
    const clone = await DocumentTemplate.create({
      ...raw,
      _id: undefined,
      name,
      code: `SYS-${slugCode(name)}`,
      isDefault: false,
      version: 1,
      sourceSystemTemplateId: source._id,
      createdBy: req.admin?.id || null,
      updatedBy: req.admin?.id || null,
      createdAt: undefined,
      updatedAt: undefined,
    });

    audit("system_template_cloned", {
      actor: req.admin?.email,
      sourceTemplateId: String(source._id),
      templateId: String(clone._id),
    });
    res.status(201).json(clone);
  } catch {
    res.status(500).json({ message: "Failed to clone system template" });
  }
};

export const deleteSystemTemplate = async (req, res) => {
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Template not found" });
  }
  const template = await DocumentTemplate.findOne({
    _id: req.params.id,
    ...SYSTEM_FILTER,
  });
  if (!template) return res.status(404).json({ message: "Template not found" });

  await DocumentTemplate.findByIdAndDelete(template._id);
  audit("system_template_deleted", {
    actor: req.admin?.email,
    templateId: String(template._id),
    name: template.name,
  });
  res.json({ message: "Template deleted" });
};

export const previewSystemTemplate = async (req, res) => {
  try {
    const body = req.body || {};
    let templateInput = body.template || null;
    const templateId = body.templateId || req.params.id;

    if (!templateInput && templateId) {
      if (isBadId(templateId)) {
        return res.status(404).json({ message: "Template not found" });
      }
      const stored = await DocumentTemplate.findOne({
        _id: templateId,
        ...SYSTEM_FILTER,
      });
      if (!stored) return res.status(404).json({ message: "Template not found" });
      templateInput = stored.toObject();
    }
    if (!templateInput) {
      return res.status(400).json({ message: "Template is required for preview" });
    }

    const docType =
      body.docType === "invoice" || templateInput.docType === "invoice"
        ? "invoice"
        : "quotation";
    const normalizedInput = { ...templateInput, docType };
    if (!normalizedInput.name) normalizedInput.name = "Preview Template";

    const { data, error } = normalizeTemplatePayload(normalizedInput);
    if (error) return res.status(400).json({ message: error });

    let company = DEMO_COMPANY;
    if (body.companyId) {
      if (isBadId(body.companyId)) {
        return res.status(400).json({ message: "Invalid company" });
      }
      const storedCompany = await Company.findById(body.companyId);
      if (!storedCompany) return res.status(404).json({ message: "Company not found" });
      company = storedCompany.toObject();
    }

    const sample = buildSampleDocument(docType, company, data);
    const overrides = body.document || {};
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
            : `<div style="width:100%;padding:0 14mm;font-family:Arial,sans-serif;font-size:8px;color:#64748b;display:flex;justify-content:space-between;"><span>${escapeHtmlText(company.name || "")}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
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

function escapeHtmlText(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const assignTemplate = async (req, res) => {
  try {
    if (isBadId(req.params.id)) {
      return res.status(404).json({ message: "Template not found" });
    }
    const { companyIds, makeDefault } = req.body || {};
    const result = await assignSystemTemplate(req.params.id, {
      companyIds,
      makeDefault: Boolean(makeDefault),
      adminId: req.admin?.id || null,
    });

    audit("system_template_assigned", {
      actor: req.admin?.email,
      templateId: String(result.master._id),
      companyIds: result.assigned.map((item) => String(item.companyId)),
      skipped: result.skipped,
    });

    res.json({
      message: result.assigned.length
        ? `Assigned to ${result.assigned.length} company(ies)`
        : "No new companies were assigned",
      assigned: result.assigned,
      skipped: result.skipped,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.status ? err.message : "Failed to assign template",
    });
  }
};

export const listAssignments = async (req, res) => {
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Template not found" });
  }
  const master = await DocumentTemplate.findOne({
    _id: req.params.id,
    ...SYSTEM_FILTER,
  });
  if (!master) return res.status(404).json({ message: "Template not found" });

  const copies = await DocumentTemplate.find({
    sourceSystemTemplateId: master._id,
    companyId: { $ne: null },
  })
    .select("companyId name isDefault isActive createdAt")
    .populate("companyId", "name code status isActive")
    .sort({ createdAt: 1 });

  res.json({ template: master, assignments: copies });
};

export const unassignTemplate = async (req, res) => {
  if (isBadId(req.params.id)) {
    return res.status(404).json({ message: "Template not found" });
  }
  const companyId = req.body?.companyId;
  if (!companyId || isBadId(companyId)) {
    return res.status(400).json({ message: "Choose a valid company" });
  }

  const master = await DocumentTemplate.findOne({
    _id: req.params.id,
    ...SYSTEM_FILTER,
  });
  if (!master) return res.status(404).json({ message: "Template not found" });

  const copy = await DocumentTemplate.findOne({
    sourceSystemTemplateId: master._id,
    companyId,
  });
  if (!copy) return res.status(404).json({ message: "Assignment not found" });
  if (copy.isDefault) {
    return res.status(409).json({
      message: "Choose another default template in that company before unassigning",
    });
  }

  await DocumentTemplate.findByIdAndDelete(copy._id);
  audit("system_template_unassigned", {
    actor: req.admin?.email,
    templateId: String(master._id),
    companyId: String(companyId),
  });
  res.json({ message: "Template unassigned" });
};

export const getSystemTemplateLimits = async (_req, res) => {
  res.json({ maxTemplatesPerType: MAX_TEMPLATES_PER_TYPE, presets: PRESET_META });
};
