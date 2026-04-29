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

/**
 * GET /printers/check
 * Check network printer status via TCP ping
 * Query params: target (IP address), port (optional, default 9100)
 */
router.get("/check", async (req, res) => {
  try {
    const { target, port = 9100 } = req.query;

    if (!target) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "MISSING_TARGET",
          message: "Parameter 'target' (IP address) is required",
        },
      });
    }

    const isOnline = await printerService.checkNetworkPrinter(target, parseInt(port, 10));

    logger.log(`[route] GET /printers/check -> target=${target}:${port} online=${isOnline}`);

    res.json({
      ok: true,
      target,
      port,
      online: isOnline,
    });
  } catch (e) {
    logger.error(`[route] GET /printers/check failed for ${req.query.target}:`, e);
    res.status(500).json({
      ok: false,
      error: {
        code: "CHECK_ERROR",
        message: String(e?.message || e),
      },
    });
  }
});

/**
 * GET /printers/check-usb
 * Check USB printer status via WMI
 * Query params: target (Printer Name)
 */
router.get("/check-usb", async (req, res) => {
  try {
    const { target } = req.query;

    if (!target) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "MISSING_TARGET",
          message: "Parameter 'target' (Printer Name) is required",
        },
      });
    }

    const status = await printerService.checkUsbPrinter(target);

    logger.log(`[route] GET /printers/check-usb -> target="${target}" online=${status.online}`);

    res.json({
      ok: true,
      target,
      status, // { online, printerStatus, statusLabel, isOffline, reason }
    });
  } catch (e) {
    logger.error(`[route] GET /printers/check-usb failed for "${req.query.target}":`, e);
    res.status(500).json({
      ok: false,
      error: {
        code: "CHECK_USB_ERROR",
        message: String(e?.message || e),
      },
    });
  }
});

module.exports = router;
