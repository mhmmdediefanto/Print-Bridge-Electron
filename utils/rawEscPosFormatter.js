const { nativeImage } = require("electron");

const ESC = "\x1b";
const GS = "\x1d";

// Helper functions for raw ESC/POS formatting
const commands = {
  INIT: Buffer.from([0x1b, 0x40]), // ESC @
  LF: Buffer.from([0x0a]),
  BOLD_ON: Buffer.from([0x1b, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([0x1b, 0x45, 0x00]),
  ALIGN_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  ALIGN_RIGHT: Buffer.from([0x1b, 0x61, 0x02]),
  CUT_FULL: Buffer.from([0x1d, 0x56, 0x00]),
  CUT_PARTIAL: Buffer.from([0x1d, 0x56, 0x42, 0x00]), // GS V 66 0 (minimal feed)
};

/**
 * Konversi DataURL gambar menjadi perintah Bitmap ESC * 
 * Menggunakan mode 8-dot single density (m=0)
 */
function buildImageBytes(dataUrl, colsWidth = 40) {
  try {
    if (!dataUrl) return null;
    
    // Max width diperkecil sesuai request (awalnya 200)
    const maxWidth = 140; 
    
    let img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) {
       console.log("[debug] Image is empty, likely unsupported format. Returning null.");
       return null;
    }

    let size = img.getSize();
    if (size.width > maxWidth) {
      const scale = maxWidth / size.width;
      const targetHeight = Math.round(size.height * scale);
      img = img.resize({ width: maxWidth, height: targetHeight, quality: "good" });
      size = img.getSize();
    }

    const { width, height } = size;
    const bitmap = img.toBitmap(); // RGBA bytes
    
    // --- AUTO CROP LOGIC ---
    let minY = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
        let hasPixel = false;
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            const a = bitmap[idx + 3];
            const r = bitmap[idx];
            const g = bitmap[idx + 1];
            const b_color = bitmap[idx + 2];
            const luma = (r * 0.299 + g * 0.587 + b_color * 0.114);
            
            if (a > 128 && luma < 128) {
                hasPixel = true;
                break;
            }
        }
        if (hasPixel) {
            if (minY === -1) minY = y;
            maxY = y;
        }
    }

    if (minY === -1) return null; // Gambar kosong
    
    // Sesuaikan posisi mulai dan tinggi efektif setelah crop
    const effectiveStartY = minY;
    const effectiveHeight = maxY + 1;
    // -----------------------

    let buffers = [];
    
    buffers.push(commands.ALIGN_CENTER);

    // Ubah line spacing ke 16/144 inch agar 8-dot graphics rapat/menyatu (tidak pecah bergaris)
    buffers.push(Buffer.from([0x1b, 0x33, 16]));

    // ESC/POS dot-matrix memakai 1 byte untuk 8 pixel vertikal
    // Format: ESC * m n1 n2 [d1 ... dk]
    for (let y = effectiveStartY; y < effectiveHeight; y += 8) {
        const m = 0;
        const n1 = width & 0xFF; 
        const n2 = (width >> 8) & 0xFF; 
        
        buffers.push(Buffer.from([0x1b, 0x2a, m, n1, n2])); 
        
        let slice = Buffer.alloc(width);
        for (let x = 0; x < width; x++) {
            let columnByte = 0x00;
            for (let b = 0; b < 8; b++) {
                const py = y + b;
                if (py < effectiveHeight) {
                    const idx = (py * width + x) * 4;
                    if (idx < bitmap.length) {
                       const r = bitmap[idx];
                       const g = bitmap[idx+1];
                       const b_color = bitmap[idx+2];
                       const a = bitmap[idx+3];
                       
                       const luma = (r * 0.299 + g * 0.587 + b_color * 0.114);
                       if (a > 128 && luma < 128) {
                           columnByte |= (1 << (7 - b)); 
                       }
                    }
                }
            }
            slice[x] = columnByte;
        }
        buffers.push(slice); 
        buffers.push(commands.LF); 
    }
    
    // Kembalikan setelan line spacing ke standar bawaan printer (1/6 inch)
    buffers.push(Buffer.from([0x1b, 0x32]));
    
    // buffers.push(commands.LF); // Dihapus untuk mengurangi spasi
    return Buffer.concat(buffers);
    
  } catch (err) {
    console.error("Gagal merender data URL Logo via ESC/POS", err.message);
    return null;
  }
}

function formatRawEscPos(invoiceData, template = null) {
  const { header, transaction, items, summary, payment, footer } =
    invoiceData || {};
    
  let buffers = [];
  
  // =========================
  // SETUP
  // =========================
  const cols = template?.columns || 40; 
  
  const write = (cmd) => {
    if (Buffer.isBuffer(cmd)) {
        buffers.push(cmd);
    } else {
        buffers.push(Buffer.from(cmd, "ascii"));
    }
  };

  const writeLine = (text) => {
    write(text);
    write(commands.LF);
  };
  
  const separator = () => {
    writeLine("-".repeat(cols));
  }

  // Format Helpers
  const formatCurrency = (amount) => {
    const n = Number(amount);
    if (!Number.isFinite(n)) return String(amount ?? "0");
    return new Intl.NumberFormat("id-ID", {
      minimumFractionDigits: 0,
    }).format(n);
  };
  
  const alignLeftRight = (left, right, width = cols) => {
      const spc = width - left.length - right.length;
      if (spc <= 0) return left + " " + right;
      return left + " ".repeat(spc) + right;
  };
  
  const wordWrapLine = (text, width) => {
     if (text.length <= width) return [text];
     const words = text.split(" ");
     let lines = [];
     let currentLine = "";
     
     words.forEach((word) => {
         if ((currentLine + " " + word).trim().length <= width) {
             currentLine = currentLine ? currentLine + " " + word : word;
         } else {
             if (currentLine) lines.push(currentLine);
             currentLine = word;
         }
     });
     if (currentLine) lines.push(currentLine);
     return lines;
  };

  // =========================
  // PRINT BUILD
  // =========================
  write(commands.INIT);

  // HEADER LOGO
  if (header?.logoDataUrl) {
     const imageBuffer = buildImageBytes(header.logoDataUrl, cols);
     if (imageBuffer) {
         write(imageBuffer);
     }
  }

  // HEADER TEXT
  if (header) {
    write(commands.ALIGN_CENTER);
    if (header.storeName) {
      write(commands.BOLD_ON);
      writeLine(header.storeName);
      write(commands.BOLD_OFF);
    }
    if (header.address) {
       let addressLines = wordWrapLine(header.address, cols);
       addressLines.forEach(l => writeLine(l));
    }
    if (header.phone) {
      writeLine(`Telp: ${header.phone}`);
    }
  }

  // TRANSACTION
  write(commands.ALIGN_LEFT);
  if (transaction) {
    if (transaction.invoiceNo) writeLine(`No  : ${transaction.invoiceNo}`);
    if (transaction.date) writeLine(`Tgl : ${transaction.date}`);
    if (transaction.cashier) writeLine(`Ksr : ${transaction.cashier}`);
    separator();
  }

  // ITEMS
  if (items?.length) {
    const qtyW = 4;
    const priceW = 9;
    const descW = cols - qtyW - priceW;

    items.forEach((item) => {
      const name = item?.name || item?.productName || "";
      const nameLines = wordWrapLine(name, cols);
      
      const qty = item?.qty ?? item?.quantity ?? 0;
      const price = item?.price ?? 0;
      const sub = item?.subtotal ?? Number(qty) * Number(price);

      nameLines.forEach((ln) => writeLine(ln));

      const qtyStr = `${qty}x`;
      const priceStr = formatCurrency(price);
      const subStr = formatCurrency(sub);
      
      const leftPart = `  ${qtyStr} @ ${priceStr}`;
      writeLine(alignLeftRight(leftPart, subStr, cols));
      
      // DISKON
      const diskon = item?.discount ?? 0;
      if (diskon > 0) {
          writeLine(alignLeftRight(`  Diskon/Item`, `-${formatCurrency(diskon)}`));
      }
    });
    separator();
  }

  // SUMMARY
  if (summary) {
    if (summary.subtotal !== undefined) {
      writeLine(alignLeftRight("Subtotal:", formatCurrency(summary.subtotal)));
    }
    if (summary.discount !== undefined && Number(summary.discount) > 0) {
      writeLine(alignLeftRight("Diskon:", `-${formatCurrency(summary.discount)}`));
    }
    if (summary.tax !== undefined && Number(summary.tax) > 0) {
      writeLine(alignLeftRight("Pajak:", formatCurrency(summary.tax)));
    }
    if (summary.total !== undefined) {
      write(commands.BOLD_ON);
      writeLine(alignLeftRight("TOTAL:", formatCurrency(summary.total)));
      write(commands.BOLD_OFF);
    }
    separator();
  }

  // PAYMENT
  if (payment) {
    if (payment.method) writeLine(alignLeftRight("Pembayaran:", payment.method));
    if (payment.paid !== undefined) {
      writeLine(alignLeftRight("Bayar:", formatCurrency(payment.paid)));
    }
    if (payment.change !== undefined && Number(payment.change) > 0) {
      writeLine(alignLeftRight("Kembalian:", formatCurrency(payment.change)));
    }
    separator();
  }

  // FOOTER
  write(commands.ALIGN_CENTER);
  if (footer?.message) {
      const fLines = wordWrapLine(footer.message, cols);
      fLines.forEach(l => writeLine(l));
  } else {
      writeLine("Terima kasih atas kunjungan Anda");
  }

  // FEED and CUT
  writeLine("");
  write(commands.CUT_PARTIAL);
  
  return Buffer.concat(buffers).toString("base64");
}

module.exports = {
  formatRawEscPos,
};
