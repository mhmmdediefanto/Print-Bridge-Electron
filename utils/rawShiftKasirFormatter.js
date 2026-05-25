const ESC = "\x1b";

const commands = {
  INIT: Buffer.from([0x1b, 0x40]),
  LF: Buffer.from([0x0a]),
  BOLD_ON: Buffer.from([0x1b, 0x45, 0x01]),
  BOLD_OFF: Buffer.from([0x1b, 0x45, 0x00]),
  ALIGN_LEFT: Buffer.from([0x1b, 0x61, 0x00]),
  ALIGN_CENTER: Buffer.from([0x1b, 0x61, 0x01]),
  CUT_PARTIAL: Buffer.from([0x1d, 0x56, 0x42, 0x00]),
};

function normalizeMoney(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value, withPrefix = true) {
  const formatted = new Intl.NumberFormat("id-ID", {
    minimumFractionDigits: 0,
  }).format(normalizeMoney(value));

  return withPrefix ? `Rp ${formatted}` : formatted;
}

function wordWrap(text, width) {
  const value = String(text ?? "").trim();
  if (!value) return [];
  if (value.length <= width) return [value];

  const words = value.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    if (word.length <= width) {
      current = word;
      continue;
    }

    for (let index = 0; index < word.length; index += width) {
      lines.push(word.slice(index, index + width));
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function padRight(left, right, width) {
  const safeLeft = String(left ?? "");
  const safeRight = String(right ?? "");
  const spacing = width - safeLeft.length - safeRight.length;

  if (spacing <= 1) {
    return `${safeLeft} ${safeRight}`.trim();
  }

  return `${safeLeft}${" ".repeat(spacing)}${safeRight}`;
}

function twoLineRow(label, value, width) {
  const safeLabel = String(label ?? "").trim();
  const safeValue = String(value ?? "").trim();
  if (!safeValue) return [safeLabel];

  const reserved = Math.max(10, safeValue.length + 1);
  const leftWidth = Math.max(8, width - reserved);
  const labelLines = wordWrap(safeLabel, leftWidth);

  if (labelLines.length === 0) {
    return [padRight("", safeValue, width)];
  }

  const rows = [];
  labelLines.forEach((line, index) => {
    if (index === 0) {
      rows.push(padRight(line, safeValue, width));
    } else {
      rows.push(line);
    }
  });

  return rows;
}

function normalizePayments(shift) {
  const paymentSources = [
    shift.payments,
    shift.paymentSummary,
    shift.metodePembayaran,
  ];

  const firstArray = paymentSources.find(Array.isArray);
  if (!firstArray) return [];

  return firstArray.map((item) => ({
    label: item.label ?? item.name ?? item.method ?? "Pembayaran",
    amount: item.amount ?? item.total ?? item.nominal ?? 0,
    count: item.count ?? item.jumlah_transaksi ?? item.total_transaksi ?? null,
  }));
}

function normalizeReturns(shift) {
  const returnSources = [
    shift.returns,
    shift.returnItems,
    shift.returs,
    shift.exchangeItems,
  ];

  const firstArray = returnSources.find(Array.isArray);
  if (!firstArray) return [];

  return firstArray.map((item) => ({
    title: item.title ?? item.name ?? item.label ?? item.no_faktur ?? "Retur / Exchange",
    subtitle:
      item.subtitle ??
      item.detail ??
      item.keterangan ??
      item.invoice_detail ??
      item.invoiceLine ??
      "",
    amount: item.amount ?? item.total ?? item.nominal ?? item.value ?? 0,
  }));
}

function normalizeExpenses(shift) {
  const expenseSources = [
    shift.expenses,
    shift.expenseItems,
    shift.pengeluaran,
    shift.pengeluaranShift,
  ];

  const firstArray = expenseSources.find(Array.isArray);
  if (!firstArray) return [];

  return firstArray.map((item) => ({
    title: item.title ?? item.name ?? item.label ?? item.nama_pengeluaran ?? "Pengeluaran",
    subtitle:
      item.subtitle ??
      item.detail ??
      item.keterangan ??
      item.created_by_name ??
      item.inputBy ??
      "",
    amount: item.amount ?? item.total ?? item.nominal ?? item.value ?? 0,
  }));
}

function normalizeTotals(shift) {
  const totals = [];

  if (Array.isArray(shift.totals)) {
    return shift.totals.map((item) => ({
      label: item.label ?? item.name ?? "Total",
      amount: item.amount ?? item.total ?? item.nominal ?? 0,
      bold: Boolean(item.bold),
    }));
  }

  const fieldMap = [
    ["TOTAL UANG MASUK", shift.totalUangMasuk ?? shift.total_uang_masuk],
    ["RETUR CASH KELUAR", shift.returCashKeluar ?? shift.retur_cash_keluar],
    ["TOTAL PENGELUARAN", shift.totalPengeluaran ?? shift.total_pengeluaran],
    ["KAS BERSIH SHIFT", shift.kasBersihShift ?? shift.kas_bersih_shift],
    ["ESTIMASI UANG FISIK", shift.estimasiUangFisik ?? shift.estimasi_uang_fisik],
  ];

  for (const [label, value] of fieldMap) {
    if (value !== undefined && value !== null && value !== "") {
      totals.push({
        label,
        amount: value,
        bold: true,
      });
    }
  }

  return totals;
}

function buildSectionTitle(title, width) {
  const lines = wordWrap(String(title ?? "").trim().toUpperCase(), width);
  return lines.length > 0 ? lines : [];
}

function formatRawShiftKasir(shiftData = {}, options = {}) {
  const cols = Math.max(32, Number(options.columns ?? 40));
  const buffers = [];

  const write = (value) => {
    buffers.push(Buffer.isBuffer(value) ? value : Buffer.from(String(value), "ascii"));
  };

  const writeLine = (text = "") => {
    write(text);
    write(commands.LF);
  };

  const separator = () => writeLine("-".repeat(cols));

  const centeredText = (text, bold = false) => {
    write(commands.ALIGN_CENTER);
    if (bold) write(commands.BOLD_ON);
    for (const line of wordWrap(text, cols)) {
      writeLine(line);
    }
    if (bold) write(commands.BOLD_OFF);
    write(commands.ALIGN_LEFT);
  };

  const shift = shiftData?.shift ?? shiftData;
  const payments = normalizePayments(shift);
  const returns = normalizeReturns(shift);
  const expenses = normalizeExpenses(shift);
  const totals = normalizeTotals(shift);
  const notes = shift.notes ?? shift.catatan ?? shift.note ?? "";

  write(commands.INIT);
  write(commands.ALIGN_LEFT);

  centeredText(shift.title ?? "RINGKASAN SHIFT KASIR", true);

  if (shift.cashierName ?? shift.namaKasir ?? shift.cashier_name) {
    centeredText(shift.cashierName ?? shift.namaKasir ?? shift.cashier_name, true);
  }
  if (shift.cashierEmail ?? shift.email ?? shift.cashier_email) {
    centeredText(shift.cashierEmail ?? shift.email ?? shift.cashier_email, true);
  }

  separator();

  const infoRows = [
    ["Opened", shift.openedAt ?? shift.opened_at ?? shift.opened],
    ["Closed", shift.closedAt ?? shift.closed_at ?? shift.closed],
    ["Status", shift.statusLabel ?? shift.status_label ?? shift.status],
    ["Kas Awal", shift.kasAwal ?? shift.kas_awal ? formatMoney(shift.kasAwal ?? shift.kas_awal) : ""],
    ["Kas Akhir", shift.kasAkhir ?? shift.kas_akhir ? formatMoney(shift.kasAkhir ?? shift.kas_akhir) : ""],
    ["Total Penjualan", shift.totalPenjualan ?? shift.total_penjualan ?? shift.jumlahPenjualan ?? shift.jumlah_penjualan],
    ["Total Retur", shift.totalRetur ?? shift.total_retur ?? shift.jumlahRetur ?? shift.jumlah_retur],
  ];

  for (const [label, value] of infoRows) {
    if (value === undefined || value === null || value === "") continue;
    for (const line of twoLineRow(label, value, cols)) {
      writeLine(line);
    }
  }

  if (payments.length > 0) {
    separator();
    for (const title of buildSectionTitle("PEMBAYARAN MASUK", cols)) {
      write(commands.BOLD_ON);
      writeLine(title);
      write(commands.BOLD_OFF);
    }

    for (const payment of payments) {
      write(commands.BOLD_ON);
      writeLine(padRight(String(payment.label).toUpperCase(), formatMoney(payment.amount), cols));
      write(commands.BOLD_OFF);

      if (payment.count !== null && payment.count !== undefined && payment.count !== "") {
        writeLine(`${payment.count} transaksi`);
      }
    }
  }

  if (returns.length > 0) {
    separator();
    for (const title of buildSectionTitle("RETUR / EXCHANGE", cols)) {
      write(commands.BOLD_ON);
      writeLine(title);
      write(commands.BOLD_OFF);
    }

    for (const entry of returns) {
      for (const line of twoLineRow(entry.title, formatMoney(entry.amount), cols)) {
        writeLine(line);
      }

      if (entry.subtitle) {
        for (const line of wordWrap(entry.subtitle, cols)) {
          writeLine(line);
        }
      }
    }
  }

  if (expenses.length > 0) {
    separator();
    for (const title of buildSectionTitle("PENGELUARAN SHIFT", cols)) {
      write(commands.BOLD_ON);
      writeLine(title);
      write(commands.BOLD_OFF);
    }

    for (const entry of expenses) {
      for (const line of twoLineRow(String(entry.title).toUpperCase(), `-${formatMoney(entry.amount)}`, cols)) {
        writeLine(line);
      }

      if (entry.subtitle) {
        for (const line of wordWrap(entry.subtitle, cols)) {
          writeLine(line);
        }
      }
    }
  }

  if (totals.length > 0) {
    separator();
    for (const total of totals) {
      if (total.bold) write(commands.BOLD_ON);
      for (const line of twoLineRow(total.label, formatMoney(total.amount), cols)) {
        writeLine(line);
      }
      if (total.bold) write(commands.BOLD_OFF);
    }
  }

  if (notes) {
    writeLine("");
    for (const line of wordWrap(`Catatan: ${notes}`, cols)) {
      writeLine(line);
    }
  }

  writeLine("");
  write(commands.CUT_PARTIAL);

  return Buffer.concat(buffers).toString("base64");
}

module.exports = {
  formatRawShiftKasir,
};
