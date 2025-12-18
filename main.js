require("dotenv").config();

const { app, BrowserWindow, Tray, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const { PosPrinter } = require("electron-pos-printer");

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

function createHiddenWindow() {
  hiddenWin = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
    },
  });
}

function createTray() {
  const iconPath = path.join(__dirname, "icon.png");
  if (!fs.existsSync(iconPath)) {
    console.warn("[bridge] icon.png not found, skipping tray");
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

  // 4) list printers
  server.get("/printers", async (_req, res) => {
    try {
      if (!hiddenWin) throw new Error("Hidden window not ready");
      const printers = await hiddenWin.webContents.getPrintersAsync();
      res.json({ ok: true, printers });
    } catch (e) {
      res.status(500).json({ ok: false, message: String(e?.message || e) });
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

      console.log("[bridge] TEST PRINT ->", options.printerName || "(default)");
      await PosPrinter.print(data, options);

      res.json({ ok: true });
    } catch (e) {
      console.error("[bridge] test-print failed:", e);
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

      console.log(
        "[bridge] PRINT ->",
        options?.printerName || "(default)",
        "items:",
        data.length
      );

      await PosPrinter.print(data, options);
      res.json({ ok: true });
    } catch (e) {
      console.error("[bridge] print failed:", e);
      res.status(500).json({ ok: false, message: String(e?.message || e) });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[bridge] listening on http://127.0.0.1:${PORT}`);
    console.log(`[bridge] key: ${API_KEY ? "(set)" : "(empty)"}`);
    console.log(
      `[bridge] allowed origins: ${
        ALLOW_ALL_ORIGINS
          ? "(ALL, as requested by PRINT_BRIDGE_ALLOW_ALL=true)"
          : ALLOWED_ORIGINS.length
          ? ALLOWED_ORIGINS.join(", ")
          : "(localhost only)"
      }`
    );
  });
}

app.whenReady().then(() => {
  try {
    createHiddenWindow();
    createTray();
    startServer();
  } catch (e) {
    console.error("[bridge] Startup error:", e);
    app.quit();
  }
});

// Jangan auto quit kalau semua window ditutup (karena ini tray/service)
app.on("window-all-closed", (e) => {
  e.preventDefault();
});
