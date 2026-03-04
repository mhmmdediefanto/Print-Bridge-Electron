const path = require("path");
const fs = require("fs");

// Setup logging ke file
// Deteksi packaged app (kode di dalam app.asar)
const isPackaged = __dirname.includes("app.asar");
let LOG_DIR;

if (isPackaged && process.versions?.electron) {
  const { app } = require("electron");
  LOG_DIR = path.join(app.getPath("userData"), "logs");
} else {
  LOG_DIR = path.join(__dirname, "..", "logs");
}

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

module.exports = logger;

