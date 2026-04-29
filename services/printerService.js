const net = require("net");
const logger = require("../utils/logger");

let hiddenWin = null;
let printerCache = null;
let printerCacheTime = null;
const PRINTER_CACHE_TTL = 5000; // cache 5 detik

/**
 * Set the hidden window instance (called from main.js)
 */
function setHiddenWindow(window) {
  hiddenWin = window;
}

/**
 * Check if hidden window is ready
 * Simplified - hanya check basic (exists, not destroyed, webContents exists)
 * Removed isLoading() check karena mungkin tidak akurat
 */
function isWindowReady() {
  if (!hiddenWin) return false;
  if (hiddenWin.isDestroyed()) return false;
  if (!hiddenWin.webContents) return false;
  // Removed isLoading() check - it might be inaccurate
  return true;
}

/**
 * Get printers dengan retry jika hiddenWin belum ready
 * Simplified - sama dengan main-backup.js yang sudah terbukti bekerja
 */
async function getPrintersWithRetry(maxRetries = 5, delayMs = 500) {
  for (let i = 0; i < maxRetries; i++) {
    // Check if window exists and webContents is available
    if (!hiddenWin || !hiddenWin.webContents) {
      if (i < maxRetries - 1) {
        logger.log(
          `[printerService] Hidden window not ready, retrying... (${
            i + 1
          }/${maxRetries})`,
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
          `[printerService] Failed to get printers, retrying... (${
            i + 1
          }/${maxRetries}):`,
          e?.message || e,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw e;
    }
  }
}

/**
 * Get list of available printers (with caching)
 * Simplified - sama dengan main-backup.js yang sudah terbukti bekerja
 * Throw error jika gagal (tidak return empty array)
 */
async function getPrinters(useCache = true) {
  try {
    // Cek cache dulu (jika masih valid) - sama dengan main-backup.js
    if (useCache) {
      const now = Date.now();
      if (
        printerCache &&
        printerCacheTime &&
        now - printerCacheTime < PRINTER_CACHE_TTL
      ) {
        logger.log(
          `[printerService] GET printers -> ${printerCache.length} printers (cached)`,
        );
        return { printers: printerCache, cached: true };
      }
    }

    // Get fresh data dengan retry
    logger.log("[printerService] GET printers -> fetching printers...");
    const printers = await getPrintersWithRetry();

    // Update cache - sama dengan main-backup.js
    printerCache = printers;
    printerCacheTime = Date.now();

    logger.log(
      `[printerService] GET printers -> ${printers.length} printer(s) found:`,
      printers.map((p) => p.name || p.displayName || "(unnamed)").join(", ") ||
        "(none)",
    );

    return { printers, cached: false };
  } catch (e) {
    logger.error("[printerService] GET printers failed:", e);
    // Throw error instead of return empty array - sama dengan main-backup.js
    throw e;
  }
}

/**
 * Check if a printer exists
 */
async function printerExists(printerName) {
  try {
    const { printers } = await getPrinters(false); // force fresh data
    return printers.some(
      (p) =>
        p.name === printerName ||
        p.displayName === printerName ||
        p.name?.toLowerCase() === printerName?.toLowerCase(),
    );
  } catch (e) {
    logger.error("[printerService] Check printer exists failed:", e);
    return false;
  }
}

/**
 * Clear printer cache
 */
function clearCache() {
  printerCache = null;
  printerCacheTime = null;
}

/**
 * Check if a network printer is reachable via TCP
 */
function checkNetworkPrinter(ip, port = 9100, timeout = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);

    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, ip);
  });
}

const { exec } = require("child_process");
const os = require("os");

module.exports = {
  setHiddenWindow,
  getPrinters,
  printerExists,
  clearCache,
  checkNetworkPrinter,
  checkUsbPrinter,
};

// ─────────────────────────────────────────────
// Cek status USB printer (Windows + Linux)
// ─────────────────────────────────────────────

function checkUsbPrinter(printerName, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!printerName) {
      return resolve({ online: false, reason: "No printer name provided" });
    }

    const platform = os.platform();
    logger.log(
      `[printerService] checkUsbPrinter -> platform="${platform}" printer="${printerName}"`,
    );

    if (platform === "win32") {
      _checkUsbWindows(printerName, timeoutMs, resolve);
    } else if (platform === "linux") {
      _checkUsbLinux(printerName, timeoutMs, resolve);
    } else {
      resolve({
        online: false,
        reason: `Platform "${platform}" not supported`,
      });
    }
  });
}

// ─────────────────────────────────────────────
// Windows: WMI via PowerShell
// ─────────────────────────────────────────────
function _checkUsbWindows(printerName, timeoutMs, resolve) {
  const safeName = printerName.replace(/'/g, "''");

  const psScript = `
    $p = Get-WmiObject Win32_Printer | Where-Object { $_.Name -eq '${safeName}' };
    if ($null -eq $p) {
      Write-Output 'NOT_FOUND'
    } else {
      $status  = if ($null -ne $p.PrinterStatus) { $p.PrinterStatus } else { -1 }
      $offline = if ($null -ne $p.WorkOffline)   { $p.WorkOffline }   else { $true }
      Write-Output "STATUS=$status;OFFLINE=$offline"
    }
  `.trim();

  const cmd = `powershell -NoProfile -NonInteractive -Command "${psScript.replace(/\n\s*/g, " ")}"`;

  logger.log(`[printerService] _checkUsbWindows -> querying WMI...`);

  const timer = setTimeout(() => {
    resolve({ online: false, reason: "WMI query timeout" });
  }, timeoutMs);

  exec(cmd, { timeout: timeoutMs }, (error, stdout) => {
    clearTimeout(timer);

    if (error) {
      logger.error("[printerService] _checkUsbWindows error:", error.message);
      return resolve({ online: false, reason: `Exec error: ${error.message}` });
    }

    const output = (stdout || "").trim();
    logger.log(`[printerService] _checkUsbWindows result: "${output}"`);

    if (!output || output === "NOT_FOUND") {
      return resolve({ online: false, reason: "Printer not found in Windows" });
    }

    const statusMatch = output.match(/STATUS=(-?\d+)/i);
    const offlineMatch = output.match(/OFFLINE=(True|False)/i);

    const printerStatus = statusMatch ? parseInt(statusMatch[1]) : -1;
    const isOffline = offlineMatch
      ? offlineMatch[1].toLowerCase() === "true"
      : true;

    // Status 3 = Idle | 4 = Printing
    const online = !isOffline && (printerStatus === 3 || printerStatus === 4);

    const statusLabel =
      {
        1: "Other",
        2: "Unknown",
        3: "Idle",
        4: "Printing",
        5: "Warmup",
        6: "Stopped",
        7: "Offline",
      }[printerStatus] || `Unknown(${printerStatus})`;

    resolve({
      online,
      printerStatus,
      statusLabel,
      isOffline,
      reason: online
        ? `Printer ready (${statusLabel})`
        : `Not ready — Status: ${statusLabel}, WorkOffline: ${isOffline}`,
    });
  });
}

// ─────────────────────────────────────────────
// Linux: lpstat + lpinfo (CUPS)
// ─────────────────────────────────────────────
function _checkUsbLinux(printerName, timeoutMs, resolve) {
  const safeName = printerName.replace(/"/g, '\\"');

  const cmd = `lpstat -p "${safeName}" 2>&1`;

  logger.log(`[printerService] _checkUsbLinux -> running: ${cmd}`);

  const timer = setTimeout(() => {
    resolve({ online: false, reason: "lpstat timeout" });
  }, timeoutMs);

  exec(cmd, { timeout: timeoutMs }, (error, stdout) => {
    clearTimeout(timer);

    const output = (stdout || "").trim().toLowerCase();
    logger.log(`[printerService] _checkUsbLinux lpstat result: "${output}"`);

    if (error && !output) {
      return resolve({ online: false, reason: "Printer not found in CUPS" });
    }

    if (output.includes("unplugged") || output.includes("turned off")) {
      return resolve({
        online: false,
        statusLabel: "Unplugged",
        isOffline: true,
        reason: "Printer unplugged or turned off (CUPS)",
      });
    }

    if (output.includes("disabled")) {
      return resolve({
        online: false,
        statusLabel: "Disabled",
        isOffline: true,
        reason: "Printer disabled in CUPS",
      });
    }

    if (output.includes("not accepting")) {
      return resolve({
        online: false,
        statusLabel: "Not Accepting",
        isOffline: false,
        reason: "Printer not accepting jobs",
      });
    }

    if (output.includes("idle") && output.includes("enabled")) {
      _checkUsbDeviceLinux(printerName, timeoutMs, (usbDetected) => {
        resolve({
          online: usbDetected,
          statusLabel: usbDetected ? "Idle" : "USB Not Detected",
          isOffline: !usbDetected,
          reason: usbDetected
            ? "Printer ready (Idle, USB detected)"
            : "CUPS says idle but USB device not found — cek kabel",
        });
      });
      return;
    }

    if (output.includes("printing")) {
      return resolve({
        online: true,
        statusLabel: "Printing",
        isOffline: false,
        reason: "Printer is printing",
      });
    }

    _checkUsbDeviceLinux(printerName, timeoutMs, (usbDetected) => {
      resolve({
        online: usbDetected,
        statusLabel: usbDetected ? "Unknown (USB OK)" : "Unknown (No USB)",
        isOffline: !usbDetected,
        reason: `lpstat: "${output || "no output"}" | USB: ${usbDetected ? "detected" : "not detected"}`,
      });
    });
  });
}

function _checkUsbDeviceLinux(printerName, timeoutMs, callback) {
  exec("lpinfo -v 2>&1", { timeout: timeoutMs }, (error, stdout) => {
    if (error || !stdout) {
      logger.log(
        "[printerService] _checkUsbDeviceLinux lpinfo failed:",
        error?.message,
      );
      return callback(false);
    }

    const output = stdout.toLowerCase();
    logger.log(
      `[printerService] _checkUsbDeviceLinux lpinfo: "${output.substring(0, 200)}..."`,
    );

    const nameKey = printerName.toLowerCase().replace(/[-_\s]/g, "");
    const found = output
      .split("\n")
      .filter((line) => line.includes("usb://"))
      .some((line) => {
        const lineKey = line.replace(/[-_\s]/g, "");
        return lineKey.includes(nameKey);
      });

    callback(found);
  });
}
