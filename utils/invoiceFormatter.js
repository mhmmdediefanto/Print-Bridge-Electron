function formatInvoice(invoiceData, template = null) {
  const { header, transaction, items, summary, payment, footer } =
    invoiceData || {};
  const printData = [];

  // =========================
  // LAYOUT KNOBS (ini yang biasanya perlu disesuaikan per printer)
  // =========================
  const layout = {
    cols: template?.columns || template?.totalWidth || 48, // 80mm umumnya 48, 58mm umumnya 32
    leftPadCols: template?.leftPadCols ?? 4, // cegah kepotong kiri (coba 2, kalau masih potong jadi 3)
    rightPadCols: template?.rightPadCols ?? 0, // kalau kanan terlalu mepet bisa 1
    useBorderSeparator: template?.useBorderSeparator ?? false,
  };

  const nbsp = "\u00A0";
  const contentCols = Math.max(
    10,
    layout.cols - layout.leftPadCols - layout.rightPadCols
  );

  const add = (x) => {
    if (!x) return;
    if (Array.isArray(x)) printData.push(...x);
    else printData.push(x);
  };

  // Helper create text item
  const text = (value, style = {}) => {
    const {
      fontSize = "12px",
      fontWeight = "400",
      textAlign = "left",
      ...rest
    } = style;

    return {
      type: "text",
      value: String(value ?? ""),
      style: {
        fontSize,
        fontWeight,
        textAlign,
        ...rest,
      },
    };
  };

  // Formatters
  const formatCurrency = (amount) => {
    const n = Number(amount);
    if (!Number.isFinite(n)) return String(amount ?? "0");
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(n);
  };

  const formatNumber = (num) => {
    const n = Number(num);
    if (!Number.isFinite(n)) return String(num ?? "0");
    return new Intl.NumberFormat("id-ID").format(n);
  };

  // Angka tanpa "Rp" untuk kolom item biar muat
  const formatMoneyNoSymbol = (amount) => {
    const n = Number(amount);
    if (!Number.isFinite(n)) return String(amount ?? "0");
    return new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0 }).format(
      n
    );
  };

  // Builder line monospace yang aman dari kepotong kiri dan overflow kanan
  const lineText = (line, style = {}) => {
    const leftPad = nbsp.repeat(layout.leftPadCols);
    const rightPad = nbsp.repeat(layout.rightPadCols);

    const s = String(line ?? "");
    const clipped = s.length > contentCols ? s.slice(0, contentCols) : s;

    return text(leftPad + clipped + rightPad, {
      whiteSpace: "pre",
      fontFamily: "monospace",
      textAlign: "left",
      ...style,
    });
  };

  // Separator
  const separator = () => {
    if (layout.useBorderSeparator) {
      // border separator kadang bikin aneh di beberapa printer, makanya default false
      return {
        type: "text",
        value: "",
        style: {
          borderTop: "1px solid #000",
          marginTop: "6px",
          marginBottom: "6px",
          width: "100%",
          display: "block",
        },
      };
    }
    return lineText("-".repeat(contentCols), { fontSize: "10px" });
  };

  // labelValue: kiri label, kanan value, pakai contentCols (bukan 48 mentah)
  // labelValue: kiri label, kanan value, pakai contentCols
  const labelValue = (label, value, options = {}) => {
    const fontSize = options.fontSize || "12px";
    const fontWeight = options.fontWeight || "400";
    const rightGapCols = options.rightGapCols ?? 0; // <-- NEW
    const minPad = options.minPad ?? 1; // <-- NEW (biar minimal ada jarak)

    const labelStr = String(label ?? "");
    const valueStr = String(value ?? "");

    const usableCols = Math.max(10, contentCols - rightGapCols);

    // kalau kepanjangan, pecah 2 baris
    if (labelStr.length + 1 + valueStr.length > usableCols) {
      return [
        lineText(labelStr, { fontSize, fontWeight }),
        lineText(valueStr, { fontSize, fontWeight }),
      ];
    }

    const spaces = usableCols - labelStr.length - valueStr.length;
    const padding = Math.max(minPad, spaces);

    // tambahin gap kanan supaya tidak “nempel” tepi
    const line =
      labelStr + nbsp.repeat(padding) + valueStr + nbsp.repeat(rightGapCols);

    return lineText(line, { fontSize, fontWeight });
  };

  // Kolom helper (NBSP supaya tidak collapse)
  const col = (val, width, align = "left") => {
    const str = String(val ?? "");
    if (str.length >= width) {
      // Jangan potong angka dari kiri (bahaya). Untuk angka, ambil dari kanan.
      return align === "right" ? str.slice(-width) : str.slice(0, width);
    }
    const pad = nbsp.repeat(width - str.length);
    return align === "right" ? pad + str : str + pad;
  };

  // Tentukan kolom item supaya tidak terlalu ke kanan
  // Dengan contentCols yang sudah dipersempit oleh leftPadCols, hasil jadi lebih natural.
  const getItemCols = () => {
    // Default 80mm contentCols biasanya 46 kalau leftPadCols=2
    if (contentCols >= 40) {
      const qty = 2; // lebih rapat
      const price = 10; // aman sampai jutaan
      const sub = 10; // aman sampai puluhan juta
      const name = Math.max(12, contentCols - (qty + price + sub));
      return { name, qty, price, sub };
    }

    // 58mm atau printer sempit
    const qty = 3;
    const price = 8;
    const sub = 8;
    const name = Math.max(10, contentCols - (qty + price + sub));
    return { name, qty, price, sub };
  };

  const itemCols = template?.itemColumns || getItemCols();

  const wrapWords = (str, width) => {
    const s = String(str ?? "").trim();
    if (!s) return [""];
    const words = s.split(/\s+/);
    const lines = [];
    let current = "";

    for (const w of words) {
      const next = current ? `${current} ${w}` : w;
      if (next.length > width) {
        if (current) lines.push(current);
        current = w;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [s.slice(0, width)];
  };

  const itemHeader = () => {
    const line =
      col("Item", itemCols.name, "left") +
      col("Qty", itemCols.qty, "right") +
      col("Harga", itemCols.price, "right") +
      col("Sub", itemCols.sub, "right");

    return lineText(line, { fontSize: "11px", fontWeight: "700" });
  };

  const itemLine = (name, qty, price, subtotal) => {
    const lines = wrapWords(name, itemCols.name);

    const qtyStr = formatNumber(qty);
    const priceStr = formatMoneyNoSymbol(price);
    const subStr = formatMoneyNoSymbol(subtotal);

    const first =
      col(lines[0], itemCols.name, "left") +
      col(qtyStr, itemCols.qty, "right") +
      col(priceStr, itemCols.price, "right") +
      col(subStr, itemCols.sub, "right");

    const out = [lineText(first, { fontSize: "12px" })];

    for (let i = 1; i < lines.length; i++) {
      const cont =
        col(lines[i], itemCols.name, "left") +
        col("", itemCols.qty, "right") +
        col("", itemCols.price, "right") +
        col("", itemCols.sub, "right");

      out.push(lineText(cont, { fontSize: "12px" }));
    }

    return out;
  };

  // =========================
  // Header Section (tidak pakai lineText supaya center bener)
  // =========================
  if (header) {
    if (header.storeName) {
      add(
        text(header.storeName, {
          textAlign: "center",
          fontSize: "18px",
          fontWeight: "700",
        })
      );
    }
    if (header.address) {
      add(text(header.address, { textAlign: "center", fontSize: "11px" }));
    }
    if (header.phone) {
      add(
        text(`Telp: ${header.phone}`, { textAlign: "center", fontSize: "11px" })
      );
    }
    add(separator());
  }

  // =========================
  // Transaction Info
  // =========================
  if (transaction) {
    if (transaction.invoiceNo)
      add(labelValue("No. Invoice:", transaction.invoiceNo));
    if (transaction.date) add(labelValue("Tanggal", transaction.date));
    if (transaction.cashier) add(labelValue("Kasir", transaction.cashier));
    add(separator());
  }

  // =========================
  // Items
  // =========================
  if (items?.length) {
    add(itemHeader());
    add(separator());

    items.forEach((item) => {
      const name = item?.name || item?.productName || "";
      const qty = item?.qty ?? item?.quantity ?? 0;
      const price = item?.price ?? 0;
      const subtotal = item?.subtotal ?? Number(qty) * Number(price);

      add(itemLine(name, qty, price, subtotal));
    });

    add(separator());
  }

  // =========================
  // Summary
  // =========================
  if (summary) {
    if (summary.subtotal !== undefined)
      add(labelValue("Subtotal", formatCurrency(summary.subtotal)));
    if (summary.discount !== undefined && Number(summary.discount) > 0)
      add(labelValue("Diskon", formatCurrency(summary.discount)));
    if (summary.tax !== undefined && Number(summary.tax) > 0)
      add(labelValue("Pajak", formatCurrency(summary.tax)));

    if (summary.total !== undefined) {
      // Total biasanya yang paling “nempel kanan”, jadi kita buat lebih aman
      add(
        labelValue("TOTAL", formatCurrency(summary.total), {
          fontSize: "14px",
          fontWeight: "700",
          rightGapCols: 7,
        })
      );
    }
    add(separator());
  }

  // =========================
  // Payment
  // =========================
  if (payment) {
    if (payment.method) add(labelValue("Pembayaran", payment.method));
    if (payment.paid !== undefined)
      add(labelValue("Bayar", formatCurrency(payment.paid)));
    if (payment.change !== undefined && Number(payment.change) > 0) {
      add(
        labelValue("Kembalian", formatCurrency(payment.change), {
          fontWeight: "700",
        })
      );
    }
    add(separator());
  }

  // =========================
  // Footer
  // =========================
  if (footer?.message) {
    add(text(footer.message, { textAlign: "center", fontSize: "11px" }));
  } else {
    add(
      text("Terima kasih atas kunjungan Anda", {
        textAlign: "center",
        fontSize: "11px",
      })
    );
  }

  return printData;
}

function getPrintOptions(template = null, printerName = null) {
  const pageSize = template?.pageSize || "80mm";

  return {
    silent: true,
    preview: false,
    copies: 1,
    printerName: printerName || undefined,
    margin: "0 0 0 0",
    timeOutPerLine: 1200,
    pageSize,
  };
}

module.exports = {
  formatInvoice,
  getPrintOptions,
};
