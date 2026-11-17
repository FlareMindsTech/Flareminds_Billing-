import { SECTION_KEYS, TEMPLATE_PRESETS, DOCUMENT_TYPES } from "../models/DocumentTemplate.js";
import {
  defaultLayout,
  defaultLabels,
  defaultContent,
  allSectionKeys,
} from "../services/templatePresets.js";

const LABEL_KEYS = Object.keys(defaultLabels("quotation"));
const FIELD_TYPES = ["text", "number", "date", "select", "boolean"];
const ITEM_FIELD_TYPES = ["text", "number", "select"];
const FONT_FAMILIES = ["Helvetica", "Arial", "Georgia", "Times New Roman"];
const HEX = /^#[0-9a-fA-F]{6}$/;

const isPlainObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function clampNumber(value, { min, max, fallback }) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function validateFields(fields, { item = false } = {}) {
  if (!Array.isArray(fields)) return { error: "Custom fields must be an array" };
  if (fields.length > (item ? 20 : 30)) {
    return { error: `Too many ${item ? "line-item" : "document"} custom fields` };
  }

  const keys = new Set();
  const clean = [];
  const validTypes = item ? ITEM_FIELD_TYPES : FIELD_TYPES;

  for (const [index, field] of fields.entries()) {
    if (!isPlainObject(field)) {
      return { error: `Custom field ${index + 1} is invalid` };
    }

    const key = text(field.key, 60);
    if (!key || !/^[A-Za-z0-9_-]{1,60}$/.test(key)) {
      return { error: `Custom field ${index + 1} requires a valid key` };
    }
    if (keys.has(key)) {
      return { error: `Duplicate custom field key: "${key}"` };
    }
    keys.add(key);

    const label = text(field.label, 100);
    if (!label) return { error: `Custom field "${key}" requires a label` };

    const type = validTypes.includes(field.type) ? field.type : "text";
    const options = Array.isArray(field.options)
      ? field.options.map((opt) => text(opt, 100)).filter(Boolean).slice(0, 50)
      : [];

    if (type === "select" && options.length === 0) {
      return { error: `Custom field "${key}" needs at least one option` };
    }

    clean.push({
      key,
      label,
      type,
      options,
      required: Boolean(field.required),
      showOnPdf: field.showOnPdf !== false,
      ...(item ? {} : { defaultValue: field.defaultValue ?? null }),
    });
  }

  return { clean };
}

const CONTENT_TEXT_FIELDS = {
  subject: 200,
  servicesBanner: 300,
  signatoryName: 120,
  signatoryTitle: 120,
  closingText: 600,
  noticeText: 600,
  validityText: 200,
  purposeText: 600,
};

function normalizeContent(input) {
  if (!isPlainObject(input)) return { error: "Template content must be an object" };

  const content = {};
  for (const [key, max] of Object.entries(CONTENT_TEXT_FIELDS)) {
    if (input[key] !== undefined) content[key] = text(input[key], max);
  }

  if (input.scopeOfWork !== undefined) {
    if (!Array.isArray(input.scopeOfWork)) {
      return { error: "Scope of work must be a list" };
    }
    content.scopeOfWork = input.scopeOfWork
      .map((item) => text(item, 300))
      .filter(Boolean)
      .slice(0, 25);
  }

  if (input.processSteps !== undefined) {
    if (!Array.isArray(input.processSteps)) {
      return { error: "Process steps must be a list" };
    }
    content.processSteps = input.processSteps
      .filter(isPlainObject)
      .map((step) => ({
        title: text(step.title, 120),
        description: text(step.description, 1000),
      }))
      .filter((step) => step.title || step.description)
      .slice(0, 15);
  }

  if (input.paymentMilestones !== undefined) {
    if (!Array.isArray(input.paymentMilestones)) {
      return { error: "Payment milestones must be a list" };
    }
    content.paymentMilestones = input.paymentMilestones
      .filter(isPlainObject)
      .map((milestone) => ({
        label: text(milestone.label, 120),
        percentage: clampNumber(milestone.percentage, { min: 0, max: 100, fallback: 0 }),
        description: text(milestone.description, 500),
      }))
      .filter((milestone) => milestone.label || milestone.percentage > 0)
      .slice(0, 12);
  }

  for (const key of [
    "showGstBreakup",
    "showAmountInWords",
    "showBankDetails",
    "showServicesBanner",
    "showSignature",
    "showPaymentSummary",
  ]) {
    if (input[key] !== undefined) content[key] = input[key] !== false;
  }

  return { content };
}

function normalizeSections(sections) {
  const input = Array.isArray(sections) ? sections : [];
  const seen = new Set();
  const result = [];

  for (const [index, section] of input.entries()) {
    if (!isPlainObject(section)) continue;
    const key = section.key;
    if (!SECTION_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({
      key,
      label: text(section.label, 100),
      enabled: section.enabled !== false,
      order: Number.isFinite(Number(section.order)) ? Number(section.order) : index,
    });
  }

  // Make sure every known section exists so old/new templates stay consistent.
  for (const key of allSectionKeys()) {
    if (!seen.has(key)) {
      result.push({ key, label: "", enabled: false, order: result.length });
    }
  }

  return result.sort((a, b) => a.order - b.order);
}

export function normalizeTemplatePayload(body = {}, { partial = false } = {}) {
  if (!isPlainObject(body)) return { error: "Invalid template payload" };

  const docType = DOCUMENT_TYPES.includes(body.docType) ? body.docType : null;
  const name = text(body.name, 100);

  if (!partial || body.name !== undefined) {
    if (!name || name.length < 2) return { error: "Template name is required" };
  }
  if (!partial && !docType) {
    return { error: "Template type must be quotation or invoice" };
  }

  const layoutInput = isPlainObject(body.layout) ? body.layout : {};
  const preset = TEMPLATE_PRESETS.includes(layoutInput.preset)
    ? layoutInput.preset
    : "classic";
  const fontFamily = FONT_FAMILIES.includes(layoutInput.fontFamily)
    ? layoutInput.fontFamily
    : "Helvetica";

  const marginInput = isPlainObject(layoutInput.margins) ? layoutInput.margins : {};
  const layout = defaultLayout({
    preset,
    fontFamily,
    accentColor: HEX.test(layoutInput.accentColor || "")
      ? layoutInput.accentColor
      : "#4f46e5",
    secondaryColor: HEX.test(layoutInput.secondaryColor || "")
      ? layoutInput.secondaryColor
      : "#0f172a",
    fontScale: clampNumber(layoutInput.fontScale, { min: 0.8, max: 1.3, fallback: 1 }),
    logoPosition: ["left", "center", "right"].includes(layoutInput.logoPosition)
      ? layoutInput.logoPosition
      : "left",
    showLogoText: layoutInput.showLogoText !== false,
    showTagline: layoutInput.showTagline !== false,
    pageSize: ["A4", "Letter"].includes(layoutInput.pageSize)
      ? layoutInput.pageSize
      : "A4",
    orientation: ["portrait", "landscape"].includes(layoutInput.orientation)
      ? layoutInput.orientation
      : "portrait",
    margins: {
      top: clampNumber(marginInput.top, { min: 0, max: 60, fallback: 14 }),
      right: clampNumber(marginInput.right, { min: 0, max: 60, fallback: 14 }),
      bottom: clampNumber(marginInput.bottom, { min: 0, max: 60, fallback: 14 }),
      left: clampNumber(marginInput.left, { min: 0, max: 60, fallback: 14 }),
    },
    tableStyle: ["bordered", "striped", "minimal"].includes(layoutInput.tableStyle)
      ? layoutInput.tableStyle
      : "bordered",
    showPageNumbers: layoutInput.showPageNumbers !== false,
    watermarkText: text(layoutInput.watermarkText, 120),
    footerText: text(layoutInput.footerText, 300),
  });

  const columnsInput = isPlainObject(body.columns) ? body.columns : {};
  const columns = {
    category: columnsInput.category !== false,
    itemType: Boolean(columnsInput.itemType),
    unit: columnsInput.unit !== false,
    discount: columnsInput.discount !== false,
    tax: columnsInput.tax !== false,
    customFields: Array.isArray(columnsInput.customFields)
      ? columnsInput.customFields.map((key) => text(key, 60)).filter(Boolean).slice(0, 20)
      : [],
  };

  const fieldResult = validateFields(body.customFields || [], { item: false });
  if (fieldResult.error) return { error: fieldResult.error };

  const itemFieldResult = validateFields(body.itemCustomFields || [], { item: true });
  if (itemFieldResult.error) return { error: itemFieldResult.error };

  const labelsInput = isPlainObject(body.labels) ? body.labels : {};
  const labels = {};
  for (const key of LABEL_KEYS) {
    if (labelsInput[key] !== undefined) {
      labels[key] = text(labelsInput[key], 60);
    }
  }

  let content = {};
  if (body.content !== undefined) {
    const contentResult = normalizeContent(body.content);
    if (contentResult.error) return { error: contentResult.error };
    content = contentResult.content;
  }

  const resolvedDocType = docType || "quotation";
  const base = {};
  if (!partial || body.docType !== undefined) base.docType = docType || "quotation";
  if (!partial || body.name !== undefined) base.name = name;
  if (body.code !== undefined) base.code = text(body.code, 40).toUpperCase();
  if (body.description !== undefined) base.description = text(body.description, 500);
  if (body.isActive !== undefined) base.isActive = Boolean(body.isActive);
  if (body.isDefault !== undefined) base.isDefault = Boolean(body.isDefault);

  if (!partial) {
    return {
      data: {
        ...base,
        layout,
        sections: normalizeSections(body.sections),
        columns,
        customFields: fieldResult.clean,
        itemCustomFields: itemFieldResult.clean,
        labels: { ...defaultLabels(base.docType, preset), ...labels },
        content: { ...defaultContent(resolvedDocType, preset), ...content },
      },
    };
  }

  const patch = {};
  if (body.layout !== undefined || body.docType !== undefined) patch.layout = layout;
  if (body.sections !== undefined || body.docType !== undefined) {
    patch.sections = normalizeSections(body.sections);
  }
  if (body.columns !== undefined) patch.columns = columns;
  if (body.customFields !== undefined) patch.customFields = fieldResult.clean;
  if (body.itemCustomFields !== undefined) patch.itemCustomFields = itemFieldResult.clean;
  if (body.labels !== undefined || body.docType !== undefined) {
    patch.labels = labels;
  }
  if (body.content !== undefined) patch.content = content;

  return { data: { ...base, ...patch } };
}
