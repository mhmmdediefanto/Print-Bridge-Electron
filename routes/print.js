const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const { PosPrinter } = require("electron-pos-printer");
const { formatInvoice, getPrintOptions } = require("../utils/invoiceFormatter");
const templateService = require("../services/templateService");
const validationService = require("../services/validationService");
const printerService = require("../services/printerService");
const os = require("os");
const path = require("path");
const fs = require("fs");

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
 * POST /print/raw
 * Print raw ESC/POS bytes langsung ke printer.
 * - Windows: menggunakan copy command dengan temp file
 * - Linux/Mac: menggunakan lp command
 * - Network: TCP socket ke port 9100
 * Bypass electron-pos-printer (Chromium raster) — kompatibel dengan semua receipt printer.
 * Body: { printerName: string, data: string (base64), copies?: number, driver?: 'local'|'network' }
 */
router.post("/raw", async (req, res) => {
  let tempFilePath = null;
  
  try {
    if (!req.body || typeof req.body !== "object") {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_PAYLOAD", message: "Request body must be a JSON object" },
      });
    }

    const { printerName, driver, data, copies } = req.body;

    if (!printerName || typeof printerName !== "string") {
      return res.status(400).json({
        ok: false,
        error: { code: "MISSING_PRINTER", message: "printerName is required" },
      });
    }

    if (!data || typeof data !== "string") {
      return res.status(400).json({
        ok: false,
        error: { code: "MISSING_DATA", message: "data (base64 ESC/POS) is required" },
      });
    }

    const rawBuffer = Buffer.from(data, "base64");
    const numCopies = Math.max(1, parseInt(copies) || 1);
    const platform = os.platform();

    logger.log(
      `[route] POST /print/raw -> ${printerName}, platform: ${platform}, driver: ${driver || 'local'}, ${rawBuffer.length} bytes, ${numCopies} copies`
    );

    // Network printer (cross-platform)
    if (driver === 'network') {
      const net = require('net');
      const printToNetwork = () => {
        return new Promise((resolve, reject) => {
          const client = new net.Socket();
          client.setTimeout(5000);
          
          client.on('error', (err) => {
            client.destroy();
            reject(new Error(`TCP Socket Error: ${err.message}`));
          });
          
          client.on('timeout', () => {
            client.destroy();
            reject(new Error(`Timeout connecting to ${printerName}:9100`));
          });
          
          client.connect(9100, printerName, () => {
            client.write(rawBuffer, () => {
              client.destroy();
              resolve();
            });
          });
        });
      };

      for (let i = 0; i < numCopies; i++) {
        await printToNetwork();
      }
      
      logger.log(`[route] POST /print/raw -> success (network, ${numCopies} copies)`);
      return res.json({ ok: true, copies: numCopies, method: 'tcp-network' });
    }

    // Local printer - Windows
    if (platform === 'win32') {
      const { spawn } = require("child_process");
      
      // Create temp file untuk raw data
      tempFilePath = path.join(os.tmpdir(), `print_raw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.raw`);
      fs.writeFileSync(tempFilePath, rawBuffer);

      // Windows: gunakan copy command dengan printer name
      // Format: copy /B tempfile "printer_name"
      // Escape printer name jika ada spasi atau karakter khusus
      // Note: Printer name harus exact match dengan nama di Windows Printers
      const escapedPrinterName = printerName.includes(' ') || printerName.includes('&')
        ? `"${printerName}"` 
        : printerName;

      for (let i = 0; i < numCopies; i++) {
        await new Promise((resolve, reject) => {
          // Gunakan cmd /c untuk menjalankan copy command dengan /B flag (binary mode)
          // /B flag penting untuk raw bytes agar tidak ada konversi line endings
          const copyCmd = spawn("cmd", ["/c", "copy", "/B", tempFilePath, escapedPrinterName], {
            shell: false, // Jangan gunakan shell untuk security
            stdio: ['ignore', 'pipe', 'pipe']
          });

          let stdout = "";
          let stderr = "";
          
          copyCmd.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
          copyCmd.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

          copyCmd.on("close", (code) => {
            // Windows copy command returns 0 on success
            // Output biasanya: "1 file(s) copied." atau "        1 file(s) copied."
            const successPattern = /file\(s\)\s+copied/i;
            if (code === 0 || successPattern.test(stdout)) {
              resolve();
            } else {
              // Jika error, cek apakah printer tidak ditemukan
              const errorMsg = stderr || stdout || `Exit code: ${code}`;
              if (errorMsg.includes("cannot find") || errorMsg.includes("tidak dapat menemukan")) {
                reject(new Error(`Printer not found: ${printerName}. Make sure printer is installed and name matches exactly.`));
              } else {
                reject(new Error(`copy command failed: ${errorMsg}`));
              }
            }
          });

          copyCmd.on("error", (err) => {
            reject(new Error(`Failed to execute copy command: ${err.message}`));
          });
        });
      }

      // Cleanup temp file
      try {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
          tempFilePath = null;
        }
      } catch (cleanupErr) {
        logger.warn(`[route] Failed to cleanup temp file: ${cleanupErr.message}`);
      }

      logger.log(`[route] POST /print/raw -> success (Windows copy, ${numCopies} copies)`);
      return res.json({ ok: true, copies: numCopies, method: 'windows-copy' });

    } else {
      // Local Print via lp (Linux/Mac)
      const { spawn } = require("child_process");

      for (let i = 0; i < numCopies; i++) {
        await new Promise((resolve, reject) => {
          const lp = spawn("lp", ["-d", printerName, "-o", "raw", "-"], {
            shell: false
          });

          let stderr = "";
          lp.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

          lp.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`lp exited with code ${code}: ${stderr}`));
            }
          });

          lp.on("error", (err) => {
            reject(new Error(`Failed to spawn lp: ${err.message}`));
          });

          lp.stdin.write(rawBuffer);
          lp.stdin.end();
        });
      }

      logger.log(`[route] POST /print/raw -> success (local lp, ${numCopies} copies)`);
      return res.json({ ok: true, copies: numCopies, method: 'local-lp' });
    }

  } catch (e) {
    // Cleanup temp file on error
    if (tempFilePath) {
      try {
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
      } catch (cleanupErr) {
        logger.warn(`[route] Failed to cleanup temp file on error: ${cleanupErr.message}`);
      }
    }

    logger.error("[route] POST /print/raw failed:", {
      error: e?.message || String(e),
    });

    const platform = os.platform();
    const hint = platform === 'win32'
      ? "Check printer connection and name. Ensure printer is installed and accessible. For network printer, use driver: 'network'."
      : "Check printer connection. If network printer, verify IP and port 9100. If local, ensure `lp` is available.";

    res.status(500).json({
      ok: false,
      error: {
        code: "RAW_PRINT_ERROR",
        message: String(e?.message || e),
        hint: hint,
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