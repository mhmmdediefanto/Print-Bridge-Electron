const { app, BrowserWindow } = require('electron');
const { PosPrinter } = require("electron-pos-printer");

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  // electron-pos-printer needs a rendered window to parse HTML to canvas to print
  // but it creates its own.
  
  const options = {
    preview: false,
    margin: "0 0 0 0",
    copies: 1,
    printerName: "EPSON-TM-U220II",
    timeOutPerLine: 400,
    pageSize: "80mm",
    silent: true
  };

  const data = [
    { type: "text", value: "DIRECT ELECTRON PRINT TEST", style: { fontWeight: "bold", textAlign: "center", fontSize: "16px" } },
    { type: "text", value: "-------------------------", style: { textAlign: "center" } },
    { type: "text", value: "If this prints normally, then standard formatting is working.", style: {} },
    { type: "text", value: "Instead of alien characters.", style: {} },
    { type: "text", value: "-------------------------", style: { textAlign: "center" } }
  ];

  try {
    console.log("Printing TEST RECEIPT to EPSON-TM-U220II...");
    await PosPrinter.print(data, options);
    console.log("Print command sent successfully");
  } catch (err) {
    console.error("Print error:", err);
  } finally {
    app.quit();
  }
});
