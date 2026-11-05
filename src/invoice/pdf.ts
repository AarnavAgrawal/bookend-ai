import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

export type InvoiceLine = { description: string; amountCents: number };

export type InvoiceDocument = {
  businessName: string;
  invoiceNumber: string;
  issuedOn: Date;
  customerName: string;
  customerAddress: string | null;
  jobTitle: string;
  lines: InvoiceLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  receipts: Array<{ bytes: Buffer; contentType: string }>;
};

const INK = rgb(0.078, 0.078, 0.078);
const GRAY = rgb(0.45, 0.45, 0.43);
const AMBER = rgb(0.91, 0.64, 0.24);
const LINE = rgb(0.87, 0.86, 0.82);

const PAGE: [number, number] = [612, 792];
const MARGIN = 54;

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The built-in PDF fonts only cover Latin text, and anything else would throw. */
const printable = (text: string) => text.replace(/[^\x20-\x7E]/g, "?");

function rightAligned(page: PDFPage, text: string, y: number, font: PDFFont, size: number) {
  const x = PAGE[0] - MARGIN - font.widthOfTextAtSize(text, size);
  page.drawText(text, { x, y, size, font, color: INK });
}

function truncate(text: string, font: PDFFont, size: number, width: number) {
  let result = printable(text);
  while (result.length > 1 && font.widthOfTextAtSize(result, size) > width) {
    result = result.slice(0, -1);
  }
  return result;
}

export async function renderInvoicePdf(invoice: InvoiceDocument): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage(PAGE);
  let y = PAGE[1] - MARGIN;

  page.drawRectangle({ x: MARGIN, y: y - 22, width: 4, height: 28, color: AMBER });
  page.drawText(printable(invoice.businessName), {
    x: MARGIN + 12,
    y: y - 16,
    size: 18,
    font: bold,
    color: INK,
  });
  rightAligned(page, `Invoice ${printable(invoice.invoiceNumber)}`, y - 8, bold, 12);
  rightAligned(page, invoice.issuedOn.toISOString().slice(0, 10), y - 24, regular, 10);
  y -= 64;

  page.drawText("Bill to", { x: MARGIN, y, size: 9, font: regular, color: GRAY });
  y -= 15;
  page.drawText(printable(invoice.customerName), { x: MARGIN, y, size: 11, font: bold, color: INK });
  if (invoice.customerAddress) {
    y -= 14;
    page.drawText(printable(invoice.customerAddress), {
      x: MARGIN,
      y,
      size: 10,
      font: regular,
      color: INK,
    });
  }
  y -= 28;
  page.drawText(printable(invoice.jobTitle), { x: MARGIN, y, size: 12, font: bold, color: INK });
  y -= 18;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE[0] - MARGIN, y },
    thickness: 0.75,
    color: LINE,
  });
  y -= 18;

  for (const line of invoice.lines) {
    if (y < MARGIN + 90) {
      page = pdf.addPage(PAGE);
      y = PAGE[1] - MARGIN;
    }
    page.drawText(truncate(line.description, regular, 10, 400), {
      x: MARGIN,
      y,
      size: 10,
      font: regular,
      color: INK,
    });
    rightAligned(page, money(line.amountCents), y, regular, 10);
    y -= 18;
  }

  y -= 6;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE[0] - MARGIN, y },
    thickness: 0.75,
    color: LINE,
  });
  y -= 18;
  for (const [label, cents, font] of [
    ["Subtotal", invoice.subtotalCents, regular],
    ["Tax", invoice.taxCents, regular],
    ["Total", invoice.totalCents, bold],
  ] as const) {
    page.drawText(label, { x: PAGE[0] - MARGIN - 180, y, size: 10, font, color: INK });
    rightAligned(page, money(cents), y, font, 10);
    y -= 16;
  }

  for (const receipt of invoice.receipts) {
    const image =
      receipt.contentType === "image/png"
        ? await pdf.embedPng(receipt.bytes)
        : await pdf.embedJpg(receipt.bytes);
    const scale = Math.min(
      (PAGE[0] - MARGIN * 2) / image.width,
      (PAGE[1] - MARGIN * 2 - 24) / image.height,
      1,
    );
    const size = image.scale(scale);
    const receiptPage = pdf.addPage(PAGE);
    receiptPage.drawText("Receipt", {
      x: MARGIN,
      y: PAGE[1] - MARGIN,
      size: 10,
      font: regular,
      color: GRAY,
    });
    receiptPage.drawImage(image, {
      x: MARGIN,
      y: PAGE[1] - MARGIN - 16 - size.height,
      width: size.width,
      height: size.height,
    });
  }

  return Buffer.from(await pdf.save());
}
