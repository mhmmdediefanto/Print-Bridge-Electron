const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const { PosPrinter } = require("electron-pos-printer");
const { formatInvoice, getPrintOptions } = require("../utils/invoiceFormatter");
const templateService = require("../services/templateService");
const validationService = require("../services/validationService");
const printerService = require("../services/printerService");

/**
 * POST /print
 * Direct print dengan format electron-pos-printer
 */
router.post("/", async (req, res) => {
  try {
    // Validate req.body exists and is valid
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      logger.warn("[route] POST /print - Invalid request body");
      return res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: "Request body is required and must be valid JSON object",
          hint: "Make sure Content-Type header is 'application/json' and body is a valid JSON object",
        },
      });
    }

    const { data, options } = req.body;

    // Validate payload
    validationService.validatePrintRequest({ data, options });

    logger.log(
      "[route] POST /print ->",
      options?.printerName || "(default)",
      "items:",
      data.length
    );

    await PosPrinter.print(data, options);
    res.json({ ok: true });
  } catch (e) {
    logger.error("[route] POST /print failed:", {
      error: e?.message || String(e),
      code: e?.code,
    });

    if (e instanceof validationService.ValidationError) {
      const errorResponse = validationService.formatErrorResponse(e);
      return res.status(400).json(errorResponse);
    }

    res.status(500).json({
      ok: false,
      error: {
        code: "PRINTER_ERROR",
        message: String(e?.message || e),
        hint: "Check printer connection and try again",
      },
    });
  }
});

/**
 * POST /print/invoice
 * Print invoice dengan format terstruktur (mudah untuk POS)
 */
router.post("/invoice", async (req, res) => {
  try {
    // Log request body untuk debugging (sanitized)
    logger.log("[route] POST /print/invoice - Request received:", {
      hasBody: !!req.body,
      bodyType: typeof req.body,
      hasInvoice: !!req.body?.invoice,
      hasTemplateId: !!req.body?.templateId,
      hasPrinterName: !!req.body?.printerName,
      invoiceType: typeof req.body?.invoice,
      invoiceIsArray: Array.isArray(req.body?.invoice),
      invoiceItemsCount: req.body?.invoice?.items?.length || 0,
      contentType: req.get("Content-Type"),
    });

    // Validate req.body exists and is valid
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      logger.warn("[route] POST /print/invoice - Invalid request body:", {
        body: req.body,
        bodyType: typeof req.body,
        isArray: Array.isArray(req.body),
      });
      return res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_PAYLOAD",
          message: "Request body is required and must be valid JSON object",
          hint: "Make sure Content-Type header is 'application/json' and body is a valid JSON object",
          details: [
            {
              field: "body",
              message: `Request body must be an object, got: ${typeof req.body}${
                Array.isArray(req.body) ? " (array)" : ""
              }`,
            },
          ],
        },
      });
    }

    const { templateId, invoice, printerName } = req.body;

    // Validate invoice data
    await validationService.validateInvoicePrintRequest({
      invoice,
      printerName,
    });

    // Verify printer exists jika printerName di-specify
    if (printerName) {
      const printerExists = await printerService.printerExists(printerName);
      if (!printerExists) {
        logger.warn(
          `[route] POST /print/invoice -> Printer not found: ${printerName}`
        );
        // Get available printers untuk hint
        const { printers } = await printerService.getPrinters();
        return res.status(400).json({
          ok: false,
          error: {
            code: "PRINTER_NOT_FOUND",
            message: `Printer not found: ${printerName}`,
            hint: `Available printers: ${printers
              .map((p) => p.name || p.displayName)
              .join(", ")}`,
            availablePrinters: printers.map((p) => ({
              name: p.name || p.displayName,
            })),
          },
        });
      }
      logger.log(
        `[route] POST /print/invoice -> Printer verified: ${printerName}`
      );
    }

    // Get template
    let template = null;
    if (templateId) {
      try {
        template = templateService.getTemplate(templateId);
      } catch (e) {
        logger.warn(
          `[route] Template ${templateId} not found, using default:`,
          e.message
        );
      }
    }

    if (!template) {
      template = templateService.getDefaultTemplate();
    }

    // Format invoice data ke format electron-pos-printer
    const printData = formatInvoice(invoice, template);

    // Get print options
    const printOptions = getPrintOptions(template, printerName);

    logger.log("[route] POST /print/invoice -> Starting print...", {
      printerName: printOptions.printerName || "(default)",
      template: template.id,
      itemsCount: invoice.items?.length || 0,
      printDataLength: printData.length,
      printOptions: printOptions,
    });

    // Print dengan error handling yang lebih detail
    try {
      await PosPrinter.print(printData, printOptions);
      logger.log(
        "[route] POST /print/invoice -> Print completed successfully",
        {
          printer: printOptions.printerName || "(default)",
          template: template.id,
        }
      );
    } catch (printError) {
      logger.error("[route] POST /print/invoice -> Print execution failed:", {
        error: printError?.message || String(printError),
        code: printError?.code,
        stack: printError?.stack,
        printerName: printOptions.printerName,
        printOptions: printOptions,
      });
      throw printError; // Re-throw untuk di-handle di outer catch
    }

    res.json({
      ok: true,
      template: template.id,
      printer: printOptions.printerName || "(default)",
    });
  } catch (e) {
    logger.error("[route] POST /print/invoice failed:", {
      error: e?.message || String(e),
      code: e?.code,
      stack: e?.stack,
      requestBody: {
        hasInvoice: !!req.body?.invoice,
        hasTemplateId: !!req.body?.templateId,
        hasPrinterName: !!req.body?.printerName,
      },
    });

    if (e instanceof validationService.ValidationError) {
      const errorResponse = validationService.formatErrorResponse(e);
      return res.status(400).json(errorResponse);
    }

    res.status(500).json({
      ok: false,
      error: {
        code: "PRINTER_ERROR",
        message: String(e?.message || e),
        hint: "Check printer connection and try again",
      },
    });
  }
});

/**
 * POST /print/validate
 * Validate print payload tanpa print (untuk testing/debugging)
 */
router.post("/validate", async (req, res) => {
  try {
    const { templateId, invoice, printerName, data, options } = req.body || {};

    const errors = [];
    const warnings = [];

    // Validate invoice format
    if (invoice) {
      try {
        await validationService.validateInvoicePrintRequest({
          invoice,
          printerName,
        });
      } catch (e) {
        if (e instanceof validationService.ValidationError) {
          e.details?.forEach((detail) => {
            if (detail.warning) {
              warnings.push(detail.message);
            } else {
              errors.push(detail.message);
            }
          });
          if (!e.details || e.details.length === 0) {
            errors.push(e.message);
          }
        } else {
          errors.push(String(e?.message || e));
        }
      }

      // Validate template if specified
      if (templateId) {
        try {
          templateService.getTemplate(templateId);
        } catch (e) {
          errors.push(`Template not found: ${templateId}`);
        }
      }
    }

    // Validate direct print format
    if (data || options) {
      try {
        validationService.validatePrintRequest({ data, options });
      } catch (e) {
        if (e instanceof validationService.ValidationError) {
          errors.push(e.message);
        } else {
          errors.push(String(e?.message || e));
        }
      }
    }

    const valid = errors.length === 0;

    logger.log(
      `[route] POST /print/validate -> valid: ${valid}, errors: ${errors.length}, warnings: ${warnings.length}`
    );

    res.json({
      ok: true,
      valid,
      errors,
      warnings,
    });
  } catch (e) {
    logger.error("[route] POST /print/validate failed:", e);
    res.status(500).json({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: String(e?.message || e),
      },
    });
  }
});

/**
 * POST /print/test-print
 * Test print dengan struk test
 */
router.post("/test-print", async (req, res) => {
  try {
    const { printerName } = req.body || {};

    const options = {
      silent: true,
      preview: false,
      copies: 1,
      printerName: printerName || undefined,
      margin: "0 0 0 0",
      timeOutPerLine: 1200,
      pageSize: "80mm",
    };

    const now = new Date().toLocaleString("id-ID");

    const data = [
      {
        type: "text",
        value: "POS PRINT BRIDGE",
        style: {
          textAlign: "center",
          fontSize: "18px",
          fontWeight: "700",
        },
      },
      {
        type: "text",
        value: "=== TEST PRINT ===",
        style: {
          textAlign: "center",
          fontSize: "14px",
          fontWeight: "700",
        },
      },
      {
        type: "text",
        value: "--------------------------------",
        style: { textAlign: "center", fontSize: "10px" },
      },
      {
        type: "text",
        value: `Waktu   : ${now}`,
        style: { fontSize: "12px" },
      },
      {
        type: "text",
        value: `Printer : ${printerName || "(default)"}`,
        style: { fontSize: "12px" },
      },
      {
        type: "text",
        value: "--------------------------------",
        style: { textAlign: "center", fontSize: "10px" },
      },
      {
        type: "text",
        value: "Jika struk ini tercetak:",
        style: { fontSize: "12px", fontWeight: "700" },
      },
      {
        type: "text",
        value: "- Koneksi bridge OK",
        style: { fontSize: "12px" },
      },
      {
        type: "text",
        value: "- API key & CORS OK",
        style: { fontSize: "12px" },
      },
      {
        type: "text",
        value: "- Printer responsif",
        style: { fontSize: "12px" },
      },
      {
        type: "text",
        value: "--------------------------------",
        style: { textAlign: "center", fontSize: "10px" },
      },
      {
        type: "text",
        value: "Terima kasih telah menggunakan",
        style: { textAlign: "center", fontSize: "11px" },
      },
      {
        type: "text",
        value: "POS Print Bridge",
        style: {
          textAlign: "center",
          fontSize: "12px",
          fontWeight: "700",
        },
      },
    ];

    logger.log("[route] TEST PRINT ->", options.printerName || "(default)");
    await PosPrinter.print(data, options);

    res.json({ ok: true });
  } catch (e) {
    logger.error("[route] test-print failed:", e);
    res.status(500).json({
      ok: false,
      error: {
        code: "PRINTER_ERROR",
        message: String(e?.message || e),
      },
    });
  }
});

module.exports = router;
