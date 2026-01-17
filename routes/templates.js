const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const templateService = require("../services/templateService");

/**
 * GET /templates
 * Get list of all available templates
 */
router.get("/", (req, res) => {
  try {
    const templates = templateService.getAllTemplates();
    const templateList = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      pageSize: t.pageSize,
    }));

    logger.log(`[route] GET /templates -> ${templateList.length} template(s)`);
    res.json({ ok: true, templates: templateList });
  } catch (e) {
    logger.error("[route] GET /templates failed:", e);
    res.status(500).json({
      ok: false,
      error: {
        code: "TEMPLATE_ERROR",
        message: String(e?.message || e),
      },
    });
  }
});

/**
 * GET /templates/:id
 * Get detail of a specific template
 */
router.get("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const template = templateService.getTemplate(id);

    logger.log(`[route] GET /templates/${id} -> found`);
    res.json({ ok: true, template });
  } catch (e) {
    logger.error(`[route] GET /templates/${req.params.id} failed:`, e);
    res.status(404).json({
      ok: false,
      error: {
        code: "TEMPLATE_NOT_FOUND",
        message: String(e?.message || e),
      },
    });
  }
});

module.exports = router;

