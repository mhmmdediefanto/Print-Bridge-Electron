require("dotenv").config();

const { app, BrowserWindow, Tray, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const { PosPrinter } = require("electron-pos-printer");

// Setup logging ke file
const LOG_DIR = path.join(__dirname, "logs");
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB per file
const MAX_LOG_FILES = 5; // keep 5 files max

// Pastikan folder logs ada
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFileName() {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `bridge-${today}.log`);
}

function rotateLogsIfNeeded(logFile) {
  try {
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > MAX_LOG_SIZE) {
        // Rotate: rename current file dengan timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const rotatedFile = logFile.replace(".log", `-${timestamp}.log`);
        fs.renameSync(logFile, rotatedFile);

        // Cleanup old files (keep only MAX_LOG_FILES)
        const logFiles = fs
          .readdirSync(LOG_DIR)
          .filter((f) => f.startsWith("bridge-") && f.endsWith(".log"))
          .map((f) => ({
            name: f,
            path: path.join(LOG_DIR, f),
            time: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime(),
          }))
          .sort((a, b) => b.time - a.time);

        // Delete old files
        if (logFiles.length > MAX_LOG_FILES) {
          logFiles.slice(MAX_LOG_FILES).forEach((file) => {
            try {
              fs.unlinkSync(file.path);
            } catch (e) {
              // ignore
            }
          });
        }
      }
    }
  } catch (e) {
    // ignore rotation errors
  }
}

function formatLogMessage(level, ...args) {
  const timestamp = new Date().toISOString();
  const message = args
    .map((arg) => {
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(" ");
  return `[${timestamp}] [${level}] ${message}\n`;
}

const logger = {
  log: (...args) => {
    const msg = formatLogMessage("INFO", ...args);
    const logFile = getLogFileName();
    rotateLogsIfNeeded(logFile);
    try {
      fs.appendFileSync(logFile, msg, "utf8");
    } catch (e) {
      // fallback to console if file write fails
      console.error("[logger] Failed to write log:", e);
    }
    console.log(...args); // tetap output ke console
  },
  warn: (...args) => {
    const msg = formatLogMessage("WARN", ...args);
    const logFile = getLogFileName();
    rotateLogsIfNeeded(logFile);
    try {
      fs.appendFileSync(logFile, msg, "utf8");
    } catch (e) {
      console.error("[logger] Failed to write log:", e);
    }
    console.warn(...args);
  },
  error: (...args) => {
    const msg = formatLogMessage("ERROR", ...args);
    const logFile = getLogFileName();
    rotateLogsIfNeeded(logFile);
    try {
      fs.appendFileSync(logFile, msg, "utf8");
    } catch (e) {
      console.error("[logger] Failed to write log:", e);
    }
    console.error(...args);
  },
};

const PORT = Number(process.env.PRINT_BRIDGE_PORT || 1818);
const API_KEY = process.env.PRINT_BRIDGE_KEY || "dev-secret-key";
const ALLOW_ALL_ORIGINS =
  String(process.env.PRINT_BRIDGE_ALLOW_ALL || "").toLowerCase() === "true";

// contoh:
// PRINT_BRIDGE_ALLOWED_ORIGINS="https://seller.gayabaru.online,http://pos-kasir.local"
const ALLOWED_ORIGINS = (process.env.PRINT_BRIDGE_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let tray = null;
let hiddenWin = null;
let printerCache = null;
let printerCacheTime = null;
const PRINTER_CACHE_TTL = 5000; // cache 5 detik

function createHiddenWindow() {
  hiddenWin = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });

  hiddenWin.webContents.once("did-finish-load", () => {
    logger.log("[bridge] Hidden window ready for printer detection");
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "icon.png");
  if (!fs.existsSync(iconPath)) {
    logger.warn("[bridge] icon.png not found, skipping tray");
    return;
  }

  tray = new Tray(iconPath);
  const menu = Menu.buildFromTemplate([
    { label: `Print Bridge: Running (:${PORT})`, enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setToolTip("POS Print Bridge");
  tray.setContextMenu(menu);
}

// Helper: get printers dengan retry jika hiddenWin belum ready
async function getPrintersWithRetry(maxRetries = 3, delayMs = 500) {
  for (let i = 0; i < maxRetries; i++) {
    if (!hiddenWin) {
      if (i < maxRetries - 1) {
        logger.log(
          `[bridge] Hidden window not ready, retrying... (${
            i + 1
          }/${maxRetries})`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw new Error("Hidden window not ready after retries");
    }

    try {
      const printers = await hiddenWin.webContents.getPrintersAsync();
      return printers;
    } catch (e) {
      if (i < maxRetries - 1) {
        logger.log(
          `[bridge] Failed to get printers, retrying... (${
            i + 1
          }/${maxRetries}):`,
          e?.message || e
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw e;
    }
  }
}

function makeCorsOptions() {
  return {
    origin: (origin, cb) => {
      // origin null biasanya dari file:// atau beberapa kondisi dev
      if (!origin) return cb(null, true);

      // allow all jika diizinkan lewat env (misal dev/testing)
      if (ALLOW_ALL_ORIGINS) return cb(null, true);

      // allow localhost origins
      if (
        origin.startsWith("http://127.0.0.1") ||
        origin.startsWith("http://localhost")
      ) {
        return cb(null, true);
      }

      // allowlist dari env
      if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)) {
        return cb(null, true);
      }

      return cb(new Error(`CORS blocked for origin: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-KEY"],
    optionsSuccessStatus: 204,
  };
}

function startServer() {
  const server = express();
  server.use(express.json({ limit: "5mb" }));

  // 1) CORS duluan + handle preflight
  const corsOptions = makeCorsOptions();
  server.use(cors(corsOptions));
  // path-to-regexp v6 tidak menerima "*", pakai regex untuk wildcard
  server.options(/.*/, cors(corsOptions));

  // 2) Health TANPA API key (biar gampang cek koneksi)
  server.get("/health", (_req, res) => {
    res.json({ ok: true, app: "pos-print-bridge", port: PORT });
  });

  // 3) Auth middleware: skip OPTIONS (preflight)
  server.use((req, res, next) => {
    if (req.method === "OPTIONS") return res.sendStatus(204);

    const key = req.header("X-API-KEY");
    if (key !== API_KEY) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    next();
  });

  // 4) list printers (dengan cache & retry)
  server.get("/printers", async (_req, res) => {
    try {
      // Cek cache dulu (jika masih valid)
      const now = Date.now();
      if (
        printerCache &&
        printerCacheTime &&
        now - printerCacheTime < PRINTER_CACHE_TTL
      ) {
        logger.log(
          `[bridge] GET /printers -> ${printerCache.length} printers (cached)`
        );
        return res.json({ ok: true, printers: printerCache, cached: true });
      }

      // Get fresh data dengan retry
      logger.log("[bridge] GET /printers -> fetching printers...");
      const printers = await getPrintersWithRetry();

      // Update cache
      printerCache = printers;
      printerCacheTime = now;

      logger.log(
        `[bridge] GET /printers -> ${printers.length} printer(s) found:`,
        printers
          .map((p) => p.name || p.displayName || "(unnamed)")
          .join(", ") || "(none)"
      );

      res.json({ ok: true, printers, cached: false });
    } catch (e) {
      logger.error("[bridge] GET /printers failed:", e);
      res.status(500).json({
        ok: false,
        message: String(e?.message || e),
        hint: "Pastikan hidden window sudah ready dan printer terdeteksi sistem",
      });
    }
  });

  // 5) test print (lebih informatif & rapi)
  server.post("/test-print", async (req, res) => {
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

      logger.log("[bridge] TEST PRINT ->", options.printerName || "(default)");
      await PosPrinter.print(data, options);

      res.json({ ok: true });
    } catch (e) {
      logger.error("[bridge] test-print failed:", e);
      res.status(500).json({ ok: false, message: String(e?.message || e) });
    }
  });

  // 6) print endpoint
  server.post("/print", async (req, res) => {
    try {
      const { data, options } = req.body || {};
      if (!Array.isArray(data) || typeof options !== "object" || !options) {
        return res.status(400).json({ ok: false, message: "Invalid payload" });
      }

      logger.log(
        "[bridge] PRINT ->",
        options?.printerName || "(default)",
        "items:",
        data.length
      );

      await PosPrinter.print(data, options);
      res.json({ ok: true });
    } catch (e) {
      logger.error("[bridge] print failed:", e);
      res.status(500).json({ ok: false, message: String(e?.message || e) });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    logger.log(`[bridge] listening on http://127.0.0.1:${PORT}`);
    logger.log(
      `[bridge] allowed origins: ${
        ALLOW_ALL_ORIGINS
          ? "(ALL, as requested by PRINT_BRIDGE_ALLOW_ALL=true)"
          : ALLOWED_ORIGINS.length
          ? ALLOWED_ORIGINS.join(", ")
          : "(localhost only)"
      }`
    );
    logger.log(`[bridge] Logs directory: ${LOG_DIR}`);
  });
}

app.whenReady().then(() => {
  try {
    logger.log("[bridge] Starting Print Bridge...");
    createHiddenWindow();
    createTray();
    startServer();
  } catch (e) {
    logger.error("[bridge] Startup error:", e);
    app.quit();
  }
});

// Jangan auto quit kalau semua window ditutup (karena ini tray/service)
app.on("window-all-closed", (e) => {
  e.preventDefault();
});
