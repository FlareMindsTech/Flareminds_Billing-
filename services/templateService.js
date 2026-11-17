import mongoose from "mongoose";
import DocumentTemplate from "../models/DocumentTemplate.js";
import Company from "../models/Company.js";
import {
  buildDefaultTemplateConfig,
  PRESET_META,
  PRESET_DOC_TYPES,
} from "./templatePresets.js";

export const MAX_TEMPLATES_PER_TYPE = 25;
const isBadId = (id) => !mongoose.isValidObjectId(id);

function plain(value) {
  if (!value) return value;
  if (typeof value.toObject === "function") return value.toObject();
  return JSON.parse(JSON.stringify(value));
}

export function templateSnapshot(template, company = null) {
  const raw = plain(template) || {};
  const merged = mergeFieldDefinitions(company, raw);

  return {
    _id: raw._id ? String(raw._id) : null,
    docType: raw.docType,
    name: raw.name,
    code: raw.code,
    version: raw.version || 1,
    layout: raw.layout || {},
    sections: raw.sections || [],
    columns: raw.columns || {},
    customFields: merged.customFields,
    itemCustomFields: merged.itemCustomFields,
    labels: merged.labels,
    content: raw.content || {},
  };
}

export function mergeFieldDefinitions(company, template) {
  const companyDoc = plain(company) || {};
  const templateDoc = plain(template) || {};
  const docType = templateDoc.docType;

  const mergeByKey = (base = [], overrides = []) => {
    const map = new Map();
    for (const field of base) {
      if (field?.key) map.set(field.key, { ...field });
    }
    for (const field of overrides) {
      if (field?.key) map.set(field.key, { ...field });
    }
    return [...map.values()];
  };

  return {
    customFields: mergeByKey(
      (companyDoc.customFields || []).filter(
        (field) =>
          !docType ||
          !field.appliesTo ||
          field.appliesTo === "both" ||
          field.appliesTo === docType
      ),
      templateDoc.customFields
    ),
    itemCustomFields: mergeByKey(
      companyDoc.itemCustomFields,
      templateDoc.itemCustomFields
    ),
    labels: { ...(companyDoc.customLabels || {}), ...(templateDoc.labels || {}) },
  };
}

export async function ensureDefaultTemplates(companyId, adminId = null) {
  if (!companyId || isBadId(String(companyId))) return null;

  const result = {};
  for (const docType of ["invoice", "quotation"]) {
    let template = await DocumentTemplate.findOne({
      companyId,
      docType,
      isDefault: true,
    });

    if (!template) {
      const config = buildDefaultTemplateConfig(docType);
      try {
        template = await DocumentTemplate.create({
          ...config,
          companyId,
          createdBy: adminId,
          updatedBy: adminId,
        });
      } catch (err) {
        // A concurrent request may have created the default first.
        if (err?.code === 11000) {
          template = await DocumentTemplate.findOne({
            companyId,
            docType,
            isDefault: true,
          });
        } else {
          throw err;
        }
      }
    }

    result[docType] = template;
  }

  return result;
}

export async function resolveTemplate(companyId, docType, templateId = null) {
  if (templateId) {
    if (isBadId(String(templateId))) {
      const error = new Error("Invalid template id");
      error.status = 400;
      throw error;
    }
    const selected = await DocumentTemplate.findOne({
      _id: templateId,
      companyId,
      docType,
    });
    if (!selected) {
      const error = new Error("Template not found for this company and document type");
      error.status = 404;
      throw error;
    }
    if (selected.isActive === false) {
      const error = new Error("This template is inactive");
      error.status = 409;
      throw error;
    }
    return selected;
  }

  const defaults = await ensureDefaultTemplates(companyId);
  return defaults?.[docType] || null;
}

function slugCode(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function uniqueCopyName(companyId, docType, baseName) {
  const escaped = escapeRegExp(baseName);
  const existing = await DocumentTemplate.find({
    companyId,
    docType,
    name: { $regex: `^${escaped}( [0-9]+)?$`, $options: "i" },
  }).select("name");
  if (!existing.length) return baseName;
  const used = new Set(existing.map((item) => String(item.name).toLowerCase()));
  if (!used.has(baseName.toLowerCase())) return baseName;
  let suffix = 2;
  while (used.has(`${baseName} ${suffix}`.toLowerCase())) suffix += 1;
  return `${baseName} ${suffix}`;
}

export async function ensureSystemTemplates(adminId = null) {
  const created = [];
  for (const preset of PRESET_META) {
    if (preset.legacy) continue;
    const docTypes = PRESET_DOC_TYPES[preset.key] || ["quotation"];
    for (const docType of docTypes) {
      const code = `SYS-${preset.key.toUpperCase()}-${docType.toUpperCase()}`;

      const existing = await DocumentTemplate.findOne({
        companyId: null,
        isSystem: true,
        code,
      });
      if (existing) continue;

      const typeName = docType === "invoice" ? "Invoice" : "Quotation";
      const config = buildDefaultTemplateConfig(docType, {
        name:
          docTypes.length > 1
            ? `${preset.name} ${typeName}`
            : preset.name,
        preset: preset.key,
      });
      try {
        const template = await DocumentTemplate.create({
          ...config,
          code,
          description: preset.description,
          isDefault: false,
          isSystem: true,
          companyId: null,
          createdBy: adminId,
          updatedBy: adminId,
        });
        created.push(template);
      } catch (err) {
        if (err?.code !== 11000) throw err;
      }
    }
  }
  return created;
}

function clonePayload(source, { companyId, name, isDefault, adminId }) {
  const raw =
    typeof source.toObject === "function" ? source.toObject() : { ...source };

  return {
    companyId,
    docType: raw.docType,
    name,
    code: slugCode(name),
    description: raw.description || "",
    isDefault,
    isActive: true,
    isSystem: false,
    version: 1,
    layout: raw.layout || {},
    sections: raw.sections || [],
    columns: raw.columns || {},
    customFields: raw.customFields || [],
    itemCustomFields: raw.itemCustomFields || [],
    labels: raw.labels || {},
    content: raw.content || {},
    sourceSystemTemplateId: raw._id || null,
    createdBy: adminId || null,
    updatedBy: adminId || null,
  };
}

export async function assignSystemTemplate(
  templateId,
  { companyIds = [], makeDefault = false, adminId = null } = {}
) {
  if (isBadId(String(templateId))) {
    const error = new Error("Invalid template id");
    error.status = 400;
    throw error;
  }
  if (!Array.isArray(companyIds) || companyIds.length === 0) {
    const error = new Error("Choose at least one company");
    error.status = 400;
    throw error;
  }

  const master = await DocumentTemplate.findOne({
    _id: templateId,
    companyId: null,
    isSystem: true,
  });
  if (!master) {
    const error = new Error("System template not found");
    error.status = 404;
    throw error;
  }

  const assigned = [];
  const skipped = [];

  for (const companyId of [...new Set(companyIds.map(String))]) {
    if (isBadId(companyId)) {
      skipped.push({ companyId, reason: "invalid-company" });
      continue;
    }
    const company = await Company.findById(companyId);
    if (!company) {
      skipped.push({ companyId, reason: "company-not-found" });
      continue;
    }

    const existing = await DocumentTemplate.findOne({
      companyId,
      sourceSystemTemplateId: master._id,
    });
    if (existing) {
      if (makeDefault && !existing.isDefault) {
        await DocumentTemplate.updateMany(
          { companyId, docType: existing.docType, _id: { $ne: existing._id } },
          { $set: { isDefault: false } }
        );
        existing.isDefault = true;
        existing.isActive = true;
        existing.updatedBy = adminId || null;
        await existing.save();
      }
      skipped.push({ companyId, reason: "already-assigned", templateId: String(existing._id) });
      continue;
    }

    const count = await DocumentTemplate.countDocuments({
      companyId,
      docType: master.docType,
    });
    if (count >= MAX_TEMPLATES_PER_TYPE) {
      skipped.push({ companyId, reason: "template-limit" });
      continue;
    }

    const hasDefault = await DocumentTemplate.exists({
      companyId,
      docType: master.docType,
      isDefault: true,
    });
    const shouldBeDefault = makeDefault || !hasDefault || count === 0;
    if (shouldBeDefault) {
      await DocumentTemplate.updateMany(
        { companyId, docType: master.docType },
        { $set: { isDefault: false } }
      );
    }

    const name = await uniqueCopyName(companyId, master.docType, master.name);
    const copy = await DocumentTemplate.create(
      clonePayload(master, {
        companyId,
        name,
        isDefault: shouldBeDefault,
        adminId,
      })
    );
    assigned.push(copy);
  }

  return { master, assigned, skipped };
}
