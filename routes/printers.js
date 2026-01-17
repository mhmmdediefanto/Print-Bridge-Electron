const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const printerService = require("../services/printerService");

/**
 * GET /printers
 * Get list of available printers
 * Simplified error handling - sama dengan main-backup.js
 */
router.get("/", async (req, res) => {
  try {
    const { printers, cached } = await printerService.getPrinters();

    logger.log(
      `[route] GET /printers -> ${printers.length} printer(s) (cached: ${cached})`
    );

    res.json({ ok: true, printers, cached });
  } catch (e) {
    logger.error("[route] GET /printers failed:", e);
    res.status(500).json({
      ok: false,
      error: {
        code: "PRINTER_ERROR",
        message: String(e?.message || e),
        hint: "Pastikan hidden window sudah ready dan printer terdeteksi sistem",
      },
    });
  }
});

module.exports = router;
