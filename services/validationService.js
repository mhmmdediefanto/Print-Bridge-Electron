const logger = require("../utils/logger");
const printerService = require("./printerService");

/**
 * Validation error class
 */
class ValidationError extends Error {
  constructor(code, message, details = []) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "ValidationError";
  }
}

/**
 * Validate invoice data structure
 */
function validateInvoice(invoiceData) {
  const errors = [];

  if (!invoiceData || typeof invoiceData !== "object") {
    throw new ValidationError(
      "INVALID_PAYLOAD",
      "Invoice data is required and must be an object"
    );
  }

  // Validate items
  if (!invoiceData.items || !Array.isArray(invoiceData.items)) {
    errors.push({
      field: "invoice.items",
      message: "Items is required and must be an array",
      hint: "Items should be an array like: [{ name: 'Product', qty: 1, price: 10000 }]",
    });
  } else if (invoiceData.items.length === 0) {
    errors.push({
      field: "invoice.items",
      message: "Items array cannot be empty",
      hint: "At least one item is required in the invoice",
    });
  } else {
    // Validate each item
    invoiceData.items.forEach((item, index) => {
      if (!item.name && !item.productName) {
        errors.push({
          field: `invoice.items[${index}].name`,
          message: "Item name is required",
          hint: "Each item must have a 'name' or 'productName' field",
        });
      }
      if (item.qty === undefined && item.quantity === undefined) {
        errors.push({
          field: `invoice.items[${index}].qty`,
          message: "Item quantity is required",
          hint: "Each item must have 'qty' or 'quantity' field (number)",
        });
      } else {
        const qty = item.qty || item.quantity;
        if (typeof qty !== "number" || qty <= 0) {
          errors.push({
            field: `invoice.items[${index}].qty`,
            message: "Item quantity must be a positive number",
            hint: `Got: ${typeof qty}${
              typeof qty === "number" ? ` (${qty})` : ""
            }`,
          });
        }
      }
      if (item.price === undefined) {
        errors.push({
          field: `invoice.items[${index}].price`,
          message: "Item price is required",
          hint: "Each item must have a 'price' field (number)",
        });
      } else if (typeof item.price !== "number" || item.price < 0) {
        errors.push({
          field: `invoice.items[${index}].price`,
          message: "Item price must be a non-negative number",
          hint: `Got: ${typeof item.price}${
            typeof item.price === "number" ? ` (${item.price})` : ""
          }`,
        });
      }
    });
  }

  // Validate summary (optional but if provided, validate)
  if (invoiceData.summary) {
    if (
      invoiceData.summary.total !== undefined &&
      typeof invoiceData.summary.total !== "number"
    ) {
      errors.push({
        field: "invoice.summary.total",
        message: "Total must be a number",
      });
    }

    // Business logic: calculate expected total from items
    if (invoiceData.items && Array.isArray(invoiceData.items)) {
      const calculatedSubtotal = invoiceData.items.reduce((sum, item) => {
        const qty = item.qty || item.quantity || 0;
        const price = item.price || 0;
        return sum + qty * price;
      }, 0);

      const discount = invoiceData.summary.discount || 0;
      const tax = invoiceData.summary.tax || 0;
      const expectedTotal = calculatedSubtotal - discount + tax;

      if (
        invoiceData.summary.total !== undefined &&
        Math.abs(invoiceData.summary.total - expectedTotal) > 0.01
      ) {
        errors.push({
          field: "invoice.summary.total",
          message: `Total mismatch. Expected: ${expectedTotal.toFixed(
            2
          )}, Got: ${invoiceData.summary.total}`,
          hint: `Calculated from items: subtotal (${calculatedSubtotal}) - discount (${discount}) + tax (${tax}) = ${expectedTotal.toFixed(
            2
          )}`,
          warning: true, // Warning, not error
        });
      }
    }
  }

  if (errors.length > 0) {
    const errorMessages = errors
      .filter((e) => !e.warning)
      .map((e) => e.message)
      .join("; ");
    const warnings = errors.filter((e) => e.warning).map((e) => e.message);

    if (errorMessages) {
      throw new ValidationError("INVALID_PAYLOAD", errorMessages, errors);
    }
    // If only warnings, log them but don't throw
    if (warnings.length > 0) {
      logger.warn("[validation] Invoice validation warnings:", warnings);
    }
  }

  return true;
}

/**
 * Validate print request payload
 */
function validatePrintRequest(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object") {
    throw new ValidationError(
      "INVALID_PAYLOAD",
      "Request payload is required and must be an object"
    );
  }

  // Validate data array (for direct print)
  if (payload.data) {
    if (!Array.isArray(payload.data)) {
      throw new ValidationError("INVALID_PAYLOAD", "Data must be an array");
    }
    if (payload.data.length === 0) {
      throw new ValidationError(
        "INVALID_PAYLOAD",
        "Data array cannot be empty"
      );
    }
  }

  // Validate options
  if (payload.options) {
    if (typeof payload.options !== "object") {
      throw new ValidationError("INVALID_PAYLOAD", "Options must be an object");
    }
  }

  return true;
}

/**
 * Validate invoice print request
 */
async function validateInvoicePrintRequest(payload) {
  const errors = [];

  if (!payload || typeof payload !== "object") {
    throw new ValidationError(
      "INVALID_PAYLOAD",
      "Request payload is required and must be an object",
      [
        {
          field: "payload",
          message: "Payload must be an object",
          hint: "Make sure you're sending a valid JSON object in the request body",
        },
      ]
    );
  }

  // Validate invoice data dengan detail yang lebih jelas
  if (!payload.invoice) {
    throw new ValidationError("INVALID_PAYLOAD", "Invoice data is required", [
      {
        field: "invoice",
        message: "Field 'invoice' is required in request body",
        hint: "Request body should have structure: { invoice: { items: [...], summary: {...} } }",
      },
    ]);
  }

  // Validate invoice is object (not array or primitive)
  if (typeof payload.invoice !== "object" || Array.isArray(payload.invoice)) {
    throw new ValidationError("INVALID_PAYLOAD", "Invoice must be an object", [
      {
        field: "invoice",
        message: `Field 'invoice' must be an object, got: ${typeof payload.invoice}${
          Array.isArray(payload.invoice) ? " (array)" : ""
        }`,
        hint: "Invoice should be an object like: { items: [...], summary: {...} }",
      },
    ]);
  }

  // Validate invoice structure
  try {
    validateInvoice(payload.invoice);
  } catch (e) {
    // Re-throw dengan context yang lebih jelas
    if (e instanceof ValidationError) {
      // Add field path prefix untuk clarity
      const enhancedDetails = (e.details || []).map((detail) => ({
        ...detail,
        field: detail.field ? `invoice.${detail.field}` : "invoice",
      }));
      throw new ValidationError(e.code, e.message, enhancedDetails);
    }
    throw e;
  }

  // Validate printer if specified
  if (payload.printerName) {
    const exists = await printerService.printerExists(payload.printerName);
    if (!exists) {
      throw new ValidationError(
        "PRINTER_NOT_FOUND",
        `Printer not found: ${payload.printerName}`,
        [
          {
            field: "printerName",
            message: `Printer '${payload.printerName}' is not available`,
            hint: "Use GET /printers endpoint to get list of available printers",
          },
        ]
      );
    }
  }

  return true;
}

/**
 * Format validation error response
 */
function formatErrorResponse(error) {
  if (error instanceof ValidationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details || [],
      },
    };
  }

  // Generic error
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: String(error?.message || error),
      details: [],
    },
  };
}

module.exports = {
  ValidationError,
  validateInvoice,
  validatePrintRequest,
  validateInvoicePrintRequest,
  formatErrorResponse,
};
