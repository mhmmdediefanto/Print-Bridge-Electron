const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { app, BrowserWindow, Tray, Menu, dialog } = require("electron");
const express = require("express");
const cors = require("cors");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");

const logger = require("./utils/logger");
const printerService = require("./services/printerService");

// Load .env dari beberapa kemungkinan lokasi:
// - process.cwd()              → dev run dari project root
// - path.dirname(process.execPath) → folder EXE hasil install
// - __dirname                  → lokasi app/asarnya sendiri
(function loadEnv() {
  const candidates = [];

  try {
    candidates.push(path.join(process.cwd(), ".env"));
  } catch {
    // ignore
  }

  try {
    if (process.execPath) {
      candidates.push(path.join(path.dirname(process.execPath), ".env"));
    }
  } catch {
    // ignore
  }

  try {
    candidates.push(path.join(__dirname, ".env"));
  } catch {
    // ignore
  }

  for (const envPath of candidates) {
    try {
      if (envPath && fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        logger.log("[bridge] Loaded .env from", envPath);
        break;
      }
    } catch {
      // ignore errors saat cek / load
    }
  }
})();

// Configuration
const PORT = Number(process.env.PRINT_BRIDGE_PORT || 1818);
const API_KEY = process.env.PRINT_BRIDGE_KEY || "dev-secret-key";
const ALLOW_ALL_ORIGINS =
  String(process.env.PRINT_BRIDGE_ALLOW_ALL || "").toLowerCase() === "true";
const IS_DEV = process.env.NODE_ENV !== "production";

// contoh:
// PRINT_BRIDGE_ALLOWED_ORIGINS="https://seller.gayabaru.online,http://pos-kasir.local"
const ALLOWED_ORIGINS = (process.env.PRINT_BRIDGE_ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  // origin null biasanya dari file:// atau beberapa kondisi dev
  if (!origin) return true;

  // allow all jika diizinkan lewat env (misal dev/testing)
  if (ALLOW_ALL_ORIGINS) return true;

  // allow localhost origins
  if (
    origin.startsWith("http://127.0.0.1") ||
    origin.startsWith("http://localhost")
  ) {
    return true;
  }

  // allowlist dari env
  if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  return false;
}

function showAboutDialog() {
  const version = app.getVersion ? app.getVersion() : "unknown";

  dialog.showMessageBox({
    type: "info",
    title: "About POS Print Bridge",
    message: `POS Print Bridge`,
    detail: [
      `Version   : ${version}`,
      `Port      : ${PORT}`,
      `Mode      : ${IS_DEV ? "Development" : "Production"}`,
      `Origins   : ${
        ALLOW_ALL_ORIGINS
          ? "ALL (PRINT_BRIDGE_ALLOW_ALL=true)"
          : ALLOWED_ORIGINS.length
          ? ALLOWED_ORIGINS.join(", ")
          : "localhost only"
      }`,
    ].join("\n"),
    buttons: ["OK"],
    defaultId: 0,
  });
}

// Routes
const printersRouter = require("./routes/printers");
const printRouter = require("./routes/print");
const templatesRouter = require("./routes/templates");

let tray = null;
let hiddenWin = null;

function createHiddenWindow() {
  hiddenWin = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });

  // Load blank page untuk memastikan webContents ready
  // getPrintersAsync() memerlukan webContents yang sudah loaded
  hiddenWin.loadURL("about:blank");

  // Set window ke printer service langsung setelah dibuat
  // Ini memastikan window tersedia untuk printerService
  printerService.setHiddenWindow(hiddenWin);

  hiddenWin.webContents.once("did-finish-load", () => {
    logger.log("[bridge] Hidden window ready for printer detection");
    // Set lagi untuk memastikan (jika window di-recreate)
    printerService.setHiddenWindow(hiddenWin);
  });
}

function createTray() {
  // Gunakan icon.png yang sudah dipakai juga untuk build windows
  const iconPath = path.join(__dirname, "icon.png");
  if (!fs.existsSync(iconPath)) {
    logger.warn("[bridge] icon.png not found, skipping tray");
    return;
  }

  tray = new Tray(iconPath);
  const menu = Menu.buildFromTemplate([
    {
      label: `POS Print Bridge v${app.getVersion ? app.getVersion() : "dev"}`,
      enabled: false,
    },
    { label: `Running on :${PORT}`, enabled: false },
    { type: "separator" },
    { label: "About...", click: () => showAboutDialog() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setToolTip("POS Print Bridge");
  tray.setContextMenu(menu);
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
    // Izinkan beberapa header umum yang sering dipakai browser / library
    allowedHeaders: [
      "Content-Type",
      "X-API-KEY",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
    optionsSuccessStatus: 204,
  };
}

function startServer() {
  const server = express();
  server.use(express.json({ limit: "5mb" }));

  // 1) CORS middleware manual + handle preflight
  server.use((req, res, next) => {
    const origin = req.header("Origin");

    // Non-browser client (curl, Postman, dll)
    if (!origin) {
      return next();
    }

    if (!isOriginAllowed(origin)) {
      // Untuk origin yang tidak diizinkan, balas jelas (tanpa ACAO)
      return res.status(403).json({
        ok: false,
        error: {
          code: "CORS_BLOCKED",
          message: `CORS blocked for origin: ${origin}`,
        },
      });
    }

    // Origin diizinkan -> set header CORS
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, X-API-KEY, Authorization, X-Requested-With, Accept"
    );

    // Preflight request -> cukup balas 204 dengan header di atas
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }

    return next();
  });

  // 2) Health TANPA API key (biar gampang cek koneksi)
  server.get("/health", (_req, res) => {
    const version = app.getVersion ? app.getVersion() : "dev";
    res.json({
      ok: true,
      app: "pos-print-bridge",
      port: PORT,
      version,
      env: IS_DEV ? "development" : "production",
    });
  });

  // 3) Auth middleware: skip OPTIONS (preflight)
  server.use((req, res, next) => {
    const key = req.header("X-API-KEY");
    if (key !== API_KEY) {
      return res.status(401).json({
        ok: false,
        error: {
          code: "UNAUTHORIZED",
          message: "Unauthorized",
        },
      });
    }
    next();
  });

  // 4) Register routes
  server.use("/printers", printersRouter);
  server.use("/print", printRouter);
  server.use("/templates", templatesRouter);

  // Debug: Log semua registered routes
  logger.log("[bridge] Registered routes:");
  logger.log("  - GET  /health");
  logger.log("  - GET  /printers");
  logger.log("  - GET  /templates");
  logger.log("  - GET  /templates/:id");
  logger.log("  - POST /print");
  logger.log("  - POST /print/invoice");
  logger.log("  - POST /print/validate");
  logger.log("  - POST /print/test-print");

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
    logger.log(`[bridge] Logs directory: ${path.join(__dirname, "logs")}`);
    logger.log(
      `[bridge] API Key: ${
        API_KEY === "dev-secret-key"
          ? "⚠️  USING DEFAULT (CHANGE IN PRODUCTION!)"
          : "✓ Set"
      }`
    );
  });
}

app.whenReady().then(() => {
  try {
    logger.log("[bridge] Starting Print Bridge...");
    createHiddenWindow();
    createTray();

    // Setup auto-updater
    log.transports.file.level = "info";
    autoUpdater.logger = log;

    // Cek update 5 detik setelah aplikasi jalan
    setTimeout(() => {
      logger.log("[bridge] Checking for updates...");
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        logger.error("[bridge] Error checking update:", err);
      });
    }, 5000);

    // Kalau update sudah didownload, auto restart & install
    autoUpdater.on('update-downloaded', (info) => {
      logger.log(`[bridge] Update v${info.version} downloaded! Restarting to install...`);
      autoUpdater.quitAndInstall();
    });

    // Wait a bit for hidden window to initialize before starting server
    // This helps prevent "window not ready" errors on first request
    setTimeout(() => {
      startServer();
      logger.log(
        "[bridge] Server started. Hidden window should be ready soon."
      );
    }, 3000); // Wait 3 seconds for window to initialize (increased from 2s)
  } catch (e) {
    logger.error("[bridge] Startup error:", e);
    app.quit();
  }
});

// Jangan auto quit kalau semua window ditutup (karena ini tray/service)
app.on("window-all-closed", (e) => {
  e.preventDefault();
});