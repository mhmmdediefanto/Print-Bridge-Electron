# POS Print Bridge

Bridge service untuk mencetak ke printer POS dari aplikasi web. Aplikasi Electron yang berjalan sebagai background service dengan HTTP API untuk integrasi dengan POS system.

## Fitur

- ✅ **HTTP API** - RESTful API untuk integrasi dengan POS system
- ✅ **Template System** - Reusable print templates (invoice, struk, dll)
- ✅ **Structured Invoice Format** - Format data invoice yang mudah untuk POS
- ✅ **Printer Detection** - Auto-detect printer dengan caching
- ✅ **Validation** - Validasi payload sebelum print
- ✅ **CORS Support** - Configurable CORS untuk security
- ✅ **API Key Authentication** - Secure API access
- ✅ **Logging** - File-based logging dengan rotation
- ✅ **System Tray** - Background service dengan tray icon

## Installation

### Requirements

- Node.js 16+ 
- Windows/macOS/Linux
- Printer POS (thermal printer) terhubung ke komputer

### Setup

1. Clone repository:
```bash
git clone <repository-url>
cd print-electron-deppartment-store
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment file:
```bash
cp .env.example .env
```

4. Edit `.env` file dan set konfigurasi:
```env
PRINT_BRIDGE_PORT=1818
PRINT_BRIDGE_KEY=your-secret-api-key-here
PRINT_BRIDGE_ALLOWED_ORIGINS=https://your-pos-domain.com
```

5. Run aplikasi:
```bash
npm start
```

Aplikasi akan berjalan di background sebagai system tray. Server HTTP akan listen di `http://127.0.0.1:1818` (atau port yang dikonfigurasi).

## API Documentation

### Base URL

```
http://127.0.0.1:1818
```

### Authentication

Semua endpoint (kecuali `/health`) memerlukan API key di header:

```
X-API-KEY: your-api-key-here
```

### Endpoints

#### Health Check

**GET** `/health`

Check status server (tidak perlu API key).

**Response:**
```json
{
  "ok": true,
  "app": "pos-print-bridge",
  "port": 1818
}
```

---

#### Get Printers

**GET** `/printers`

Get list semua printer yang tersedia.

**Headers:**
```
X-API-KEY: your-api-key
```

**Response:**
```json
{
  "ok": true,
  "printers": [
    {
      "name": "POS-80 Printer",
      "displayName": "POS-80 Printer",
      "description": "Thermal Printer"
    }
  ],
  "cached": false
}
```

---

#### Get Templates

**GET** `/templates`

Get list semua template yang tersedia.

**Headers:**
```
X-API-KEY: your-api-key
```

**Response:**
```json
{
  "ok": true,
  "templates": [
    {
      "id": "invoice-80mm",
      "name": "Invoice 80mm",
      "description": "Template invoice untuk printer 80mm",
      "pageSize": "80mm"
    }
  ]
}
```

---

#### Get Template Detail

**GET** `/templates/:id`

Get detail template spesifik.

**Headers:**
```
X-API-KEY: your-api-key
```

**Response:**
```json
{
  "ok": true,
  "template": {
    "id": "invoice-80mm",
    "name": "Invoice 80mm",
    "description": "Template invoice untuk printer 80mm",
    "pageSize": "80mm",
    "sections": { ... },
    "example": { ... }
  }
}
```

---

#### Print Invoice (Recommended)

**POST** `/print/invoice`

Print invoice dengan format terstruktur (mudah untuk POS).

**Headers:**
```
X-API-KEY: your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "templateId": "invoice-80mm",
  "printerName": "POS-80 Printer",
  "invoice": {
    "header": {
      "storeName": "Toko ABC",
      "address": "Jl. Contoh 123",
      "phone": "08123456789"
    },
    "transaction": {
      "invoiceNo": "INV-001",
      "date": "2026-01-15 10:30:00",
      "cashier": "John Doe"
    },
    "items": [
      {
        "name": "Produk A",
        "qty": 2,
        "price": 50000,
        "subtotal": 100000
      }
    ],
    "summary": {
      "subtotal": 100000,
      "tax": 10000,
      "discount": 5000,
      "total": 105000
    },
    "payment": {
      "method": "Cash",
      "paid": 110000,
      "change": 5000
    },
    "footer": {
      "message": "Terima kasih"
    }
  }
}
```

**Response:**
```json
{
  "ok": true,
  "template": "invoice-80mm",
  "printer": "POS-80 Printer"
}
```

**Error Response:**
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_PAYLOAD",
    "message": "Field 'items' is required",
    "details": [
      {
        "field": "invoice.items",
        "message": "Items is required and must be an array"
      }
    ]
  }
}
```

---

#### Direct Print

**POST** `/print`

Print langsung dengan format electron-pos-printer (untuk advanced use case).

**Headers:**
```
X-API-KEY: your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "data": [
    {
      "type": "text",
      "value": "Hello World",
      "style": {
        "fontSize": "12px",
        "textAlign": "center"
      }
    }
  ],
  "options": {
    "printerName": "POS-80 Printer",
    "pageSize": "80mm",
    "silent": true,
    "preview": false
  }
}
```

**Response:**
```json
{
  "ok": true
}
```

---

#### Validate Print Request

**POST** `/print/validate`

Validasi payload sebelum print (untuk testing/debugging).

**Headers:**
```
X-API-KEY: your-api-key
Content-Type: application/json
```

**Request Body:** (sama seperti `/print/invoice`)

**Response:**
```json
{
  "ok": true,
  "valid": true,
  "errors": [],
  "warnings": []
}
```

**Invalid Response:**
```json
{
  "ok": true,
  "valid": false,
  "errors": [
    "Field 'items' is required"
  ],
  "warnings": []
}
```

---

#### Test Print

**POST** `/print/test-print`

Print test page untuk verifikasi koneksi.

**Headers:**
```
X-API-KEY: your-api-key
Content-Type: application/json
```

**Request Body:**
```json
{
  "printerName": "POS-80 Printer"
}
```

**Response:**
```json
{
  "ok": true
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | API key tidak valid atau tidak ada |
| `INVALID_PAYLOAD` | Payload tidak valid (missing fields, wrong types) |
| `PRINTER_NOT_FOUND` | Printer tidak ditemukan |
| `PRINTER_ERROR` | Error saat mencetak |
| `TEMPLATE_NOT_FOUND` | Template tidak ditemukan |
| `VALIDATION_ERROR` | Error saat validasi |
| `INTERNAL_ERROR` | Internal server error |

---

## Environment Variables

Copy `.env.example` ke `.env` dan edit sesuai kebutuhan:

| Variable | Description | Default |
|----------|-------------|---------|
| `PRINT_BRIDGE_PORT` | Port untuk HTTP server | `1818` |
| `PRINT_BRIDGE_KEY` | API key untuk autentikasi | `dev-secret-key` |
| `PRINT_BRIDGE_ALLOW_ALL` | Allow all origins (dev only) | `false` |
| `PRINT_BRIDGE_ALLOWED_ORIGINS` | Comma-separated allowed origins | - |

**⚠️ Security Warning:** Jangan gunakan default API key di production!

---

## Integration Example

### JavaScript/TypeScript

```javascript
const API_URL = 'http://127.0.0.1:1818';
const API_KEY = 'your-api-key';

async function printInvoice(invoiceData) {
  const response = await fetch(`${API_URL}/print/invoice`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': API_KEY
    },
    body: JSON.stringify({
      templateId: 'invoice-80mm',
      printerName: 'POS-80 Printer',
      invoice: invoiceData
    })
  });

  const result = await response.json();
  
  if (!result.ok) {
    throw new Error(result.error?.message || 'Print failed');
  }

  return result;
}

// Usage
printInvoice({
  header: {
    storeName: 'Toko ABC',
    address: 'Jl. Contoh 123',
    phone: '08123456789'
  },
  transaction: {
    invoiceNo: 'INV-001',
    date: new Date().toLocaleString('id-ID'),
    cashier: 'John Doe'
  },
  items: [
    {
      name: 'Produk A',
      qty: 2,
      price: 50000,
      subtotal: 100000
    }
  ],
  summary: {
    subtotal: 100000,
    tax: 10000,
    discount: 5000,
    total: 105000
  },
  payment: {
    method: 'Cash',
    paid: 110000,
    change: 5000
  },
  footer: {
    message: 'Terima kasih'
  }
}).then(() => {
  console.log('Print success!');
}).catch((error) => {
  console.error('Print failed:', error);
});
```

### PHP

```php
<?php
$apiUrl = 'http://127.0.0.1:1818';
$apiKey = 'your-api-key';

function printInvoice($invoiceData) {
    global $apiUrl, $apiKey;
    
    $data = [
        'templateId' => 'invoice-80mm',
        'printerName' => 'POS-80 Printer',
        'invoice' => $invoiceData
    ];
    
    $ch = curl_init($apiUrl . '/print/invoice');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'X-API-KEY: ' . $apiKey
    ]);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode !== 200) {
        throw new Exception('Print failed: ' . $response);
    }
    
    return json_decode($response, true);
}
?>
```

---

## Project Structure

```
print-electron-deppartment-store/
├── main.js                 # Entry point (Electron app)
├── routes/                 # API routes
│   ├── printers.js        # Printer endpoints
│   ├── print.js           # Print endpoints
│   └── templates.js      # Template endpoints
├── services/              # Business logic
│   ├── printerService.js  # Printer detection
│   ├── templateService.js # Template management
│   └── validationService.js # Validation logic
├── utils/                 # Utilities
│   ├── logger.js          # Logging utility
│   └── invoiceFormatter.js # Invoice formatter
├── templates/             # Print templates
│   ├── invoice-80mm.json
│   └── struk-simple.json
├── logs/                  # Log files
├── .env.example           # Environment variables template
└── package.json
```

---

## Logging

Logs disimpan di folder `logs/` dengan format:
- File: `bridge-YYYY-MM-DD.log`
- Auto-rotation saat file > 5MB
- Retention: 5 files maksimal

---

## Troubleshooting

### Printer tidak terdeteksi
- Pastikan printer sudah terinstall di sistem
- Restart aplikasi
- Check logs di folder `logs/`

### CORS Error
- Set `PRINT_BRIDGE_ALLOWED_ORIGINS` di `.env`
- Atau set `PRINT_BRIDGE_ALLOW_ALL=true` untuk development

### API Key Error
- Pastikan header `X-API-KEY` dikirim
- Check `.env` file untuk API key yang benar

### Print gagal
- Pastikan printer online dan ada kertas
- Check printer name di `/printers` endpoint
- Gunakan `/print/validate` untuk debug

---

## License

ISC

---

## Support

Untuk issues atau pertanyaan, silakan buat issue di repository ini.
