const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
let templateCache = null;

/**
 * Load all templates from templates directory
 */
function loadTemplates() {
  if (templateCache) {
    return templateCache;
  }

  const templates = [];

  try {
    if (!fs.existsSync(TEMPLATES_DIR)) {
      logger.warn(
        `[templateService] Templates directory not found: ${TEMPLATES_DIR}`
      );
      return templates;
    }

    const files = fs.readdirSync(TEMPLATES_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    for (const file of jsonFiles) {
      try {
        const filePath = path.join(TEMPLATES_DIR, file);
        const content = fs.readFileSync(filePath, "utf8");
        const template = JSON.parse(content);

        // Validate template structure
        if (template.id && template.name) {
          templates.push(template);
          logger.log(
            `[templateService] Loaded template: ${template.id} (${template.name})`
          );
        } else {
          logger.warn(
            `[templateService] Invalid template structure in ${file}, skipping`
          );
        }
      } catch (e) {
        logger.error(`[templateService] Failed to load template ${file}:`, e);
      }
    }

    templateCache = templates;
    return templates;
  } catch (e) {
    logger.error("[templateService] Failed to load templates:", e);
    return templates;
  }
}

/**
 * Get template by ID
 */
function getTemplate(templateId) {
  const templates = loadTemplates();
  const template = templates.find((t) => t.id === templateId);

  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }

  return template;
}

/**
 * Get all templates (list)
 */
function getAllTemplates() {
  return loadTemplates();
}

/**
 * Clear template cache (useful for development/reload)
 */
function clearCache() {
  templateCache = null;
}

/**
 * Get default template
 */
function getDefaultTemplate() {
  const templates = loadTemplates();
  // Try to find invoice-80mm first, otherwise return first template
  const defaultTemplate =
    templates.find((t) => t.id === "invoice-80mm") || templates[0];

  if (!defaultTemplate) {
    // Return a minimal default template
    return {
      id: "default",
      name: "Default Template",
      description: "Default print template",
      pageSize: "80mm",
      sections: {
        header: { enabled: true },
        items: { enabled: true },
        summary: { enabled: true },
        footer: { enabled: true },
      },
    };
  }

  return defaultTemplate;
}

module.exports = {
  loadTemplates,
  getTemplate,
  getAllTemplates,
  getDefaultTemplate,
  clearCache,
};

