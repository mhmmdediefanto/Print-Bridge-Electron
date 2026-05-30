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

function normalizeExpenses(expenseShift) {
  const expenseSources = [
    expenseShift.expenses,
    expenseShift.items,
    expenseShift.expenseItems,
    expenseShift.pengeluaran,
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
    time: item.waktu ?? item.time ?? item.created_at ?? "",
    amount: item.amount ?? item.total ?? item.nominal ?? item.value ?? 0,
  }));
}

function buildSectionTitle(title, width) {
  const lines = wordWrap(String(title ?? "").trim().toUpperCase(), width);
  return lines.length > 0 ? lines : [];
}

function formatRawPengeluaranShift(shiftData = {}, options = {}) {
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

  const expenseShift = shiftData?.expenseShift ?? shiftData;
  const expenses = normalizeExpenses(expenseShift);
  const notes = expenseShift.notes ?? expenseShift.catatan ?? expenseShift.note ?? "";
  const totalPengeluaran =
    expenseShift.totalPengeluaran ?? expenseShift.total_pengeluaran;

  write(commands.INIT);
  write(commands.ALIGN_LEFT);

  centeredText(expenseShift.title ?? "PENGELUARAN SHIFT", true);

  if (expenseShift.storeName ?? expenseShift.namaCabang ?? expenseShift.store_name) {
    centeredText(expenseShift.storeName ?? expenseShift.namaCabang ?? expenseShift.store_name, true);
  }

  if (expenseShift.cashierName ?? expenseShift.namaKasir ?? expenseShift.cashier_name) {
    centeredText(expenseShift.cashierName ?? expenseShift.namaKasir ?? expenseShift.cashier_name, true);
  }

  if (expenseShift.cashierEmail ?? expenseShift.email ?? expenseShift.cashier_email) {
    centeredText(expenseShift.cashierEmail ?? expenseShift.email ?? expenseShift.cashier_email, false);
  }

  separator();

  const infoRows = [
    ["Opened", expenseShift.openedAt ?? expenseShift.opened_at ?? expenseShift.opened],
    ["Closed", expenseShift.closedAt ?? expenseShift.closed_at ?? expenseShift.closed],
    ["Status", expenseShift.statusLabel ?? expenseShift.status_label ?? expenseShift.status],
    ["Total Item", expenseShift.totalItems ?? expenseShift.total_items ?? expenses.length],
  ];

  for (const [label, value] of infoRows) {
    if (value === undefined || value === null || value === "") continue;
    for (const line of twoLineRow(label, value, cols)) {
      writeLine(line);
    }
  }

  if (expenses.length > 0) {
    separator();
    for (const title of buildSectionTitle("DAFTAR PENGELUARAN", cols)) {
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

      if (entry.time) {
        for (const line of wordWrap(String(entry.time), cols)) {
          writeLine(line);
        }
      }
    }
  }

  if (totalPengeluaran !== undefined && totalPengeluaran !== null && totalPengeluaran !== "") {
    separator();
    write(commands.BOLD_ON);
    for (const line of twoLineRow(
      "TOTAL PENGELUARAN",
      formatMoney(totalPengeluaran),
      cols
    )) {
      writeLine(line);
    }
    write(commands.BOLD_OFF);
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
  formatRawPengeluaranShift,
};
