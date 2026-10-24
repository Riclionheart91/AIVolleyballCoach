// eslint-disable-next-line @typescript-eslint/no-var-requires
const QRCode = require("./qrVendor/index");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const QRErrorCorrectLevel = require("./qrVendor/QRErrorCorrectLevel");

/** Matrice del QR (true = modulo scuro) per un testo, calcolata in locale. */
export function matriceQr(testo: string): boolean[][] {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(testo);
  qr.make();
  const n: number = qr.getModuleCount();
  const righe: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const riga: boolean[] = [];
    for (let c = 0; c < n; c++) riga.push(!!qr.isDark(r, c));
    righe.push(riga);
  }
  return righe;
}
