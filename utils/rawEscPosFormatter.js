const ESC = "\x1b";
const GS = "\x1d";

// Helper functions for raw ESC/POS formatting
const commands = {
  INIT: ESC + "@", // Initialize printer
  LF: "\n", // Line feed
  BOLD_ON: ESC + "E" + "\x01", // Bold on
  BOLD_OFF: ESC + "E" + "\x00", // Bold off
  ALIGN_LEFT: ESC + "a" + "\x00", // Align left
  ALIGN_CENTER: ESC + "a" + "\x01", // Align center
  ALIGN_RIGHT: ESC + "a" + "\x02", // Align right
  CUT_FULL: GS + "V" + "\x00", // Full cut
  CUT_PARTIAL: GS + "V" + "\x01", // Partial cut
};

function formatRawEscPos(invoiceData, template = null) {
  const { header, transaction, items, summary, payment, footer } =
    invoiceData || {};
    
  let buffer = "";
  
  // =========================
  // SETUP
  // =========================
  const cols = template?.columns || 40; // TM-U220 usually supports 40 columns (A/B) or 33 columns (C) with 76mm roll. Safe side 40.
  
  // Append raw bytes to buffer
  const write = (cmd) => {
    buffer += cmd;
  };

  const writeLine = (text) => {
    buffer += text + commands.LF;
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
  
  // Pad strings to fixed width
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

  // HEADER
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
    writeLine("");
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
    const descW = cols - qtyW - priceW; // Flexible name width

    items.forEach((item) => {
      const name = item?.name || item?.productName || "";
      const nameLines = wordWrapLine(name, cols);
      
      const qty = item?.qty ?? item?.quantity ?? 0;
      const price = item?.price ?? 0;
      const sub = item?.subtotal ?? Number(qty) * Number(price);

      // Print first line: Item Name (can be wrapped)
      nameLines.forEach((ln) => writeLine(ln));

      // Second line: QTY x PRICE = SUBTOTAL right aligned
      const qtyStr = `${qty}x`;
      const priceStr = formatCurrency(price);
      const subStr = formatCurrency(sub);
      
      const leftPart = `  ${qtyStr} @ ${priceStr}`;
      writeLine(alignLeftRight(leftPart, subStr, cols));
    });
    separator();
  }

  // SUMMARY
  if (summary) {
    if (summary.subtotal !== undefined) {
      writeLine(alignLeftRight("Subtotal:", formatCurrency(summary.subtotal)));
    }
    if (summary.discount !== undefined && Number(summary.discount) > 0) {
      writeLine(alignLeftRight("Diskon:", formatCurrency(summary.discount)));
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
  writeLine("");
  if (footer?.message) {
      const fLines = wordWrapLine(footer.message, cols);
      fLines.forEach(l => writeLine(l));
  } else {
      writeLine("Terima kasih atas kunjungan Anda");
  }

  // FEED and CUT
  writeLine("");
  writeLine("");
  writeLine("");
  writeLine("");
  writeLine("");
  writeLine(""); // FEED FEW LINES FOR DOT MATRIX BEFORE CUT
  write(commands.CUT_PARTIAL);
  
  return Buffer.from(buffer, "ascii").toString("base64");
}

module.exports = {
  formatRawEscPos,
};
