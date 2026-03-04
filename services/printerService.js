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
          `[printerService] Failed to get printers, retrying... (${
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
          `[printerService] GET printers -> ${printerCache.length} printers (cached)`
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
      printers
        .map((p) => p.name || p.displayName || "(unnamed)")
        .join(", ") || "(none)"
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
        p.name?.toLowerCase() === printerName?.toLowerCase()
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

module.exports = {
  setHiddenWindow,
  getPrinters,
  printerExists,
  clearCache,
  checkNetworkPrinter,
};

