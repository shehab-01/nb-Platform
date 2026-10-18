import qrcode from "qrcode-generator";

import { courierLabel, type Order, type OrderItem } from "@/lib/orders";

/**
 * Shipping stickers: one invoice per order, rendered in a print window.
 *
 * The layout is a hand-port of backend/template/Nature_Bazar_Ticket_Template.pptx
 * — the .pptx is the design source, not a runtime template. Nothing is
 * rendered or stored server-side: a sticker is derived entirely from the order
 * row, so a stored PDF would only ever be a copy that goes stale the moment an
 * address is corrected. The browser's print dialog already offers "Save as
 * PDF" for anyone who wants a file.
 */

/** "label" is the 3 × 4 in (76 × 102 mm) courier sticker; "a4" the full invoice sheet. */
export type StickerSize = "label" | "a4";

const SHOP_NAME = "Nature Bazar";
/** The storefront promises free delivery, so the customer never owes one. */
const DELIVERY_FEE = 0;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The invoice date is the day the sticker is printed (the template's
 * `print_date`), written unambiguously — a courier reading "9/6/2026" cannot
 * tell September from June.
 */
function printDate(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * The order number as an inline SVG QR, replacing the template's barcode.
 *
 * Drawn from the module grid rather than the library's `createSvgTag` so the
 * code scales to its CSS box and keeps the 4-module quiet zone the spec asks
 * for — without it, scanners tend to miss a code printed flush against other
 * ink.
 */
function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const quiet = 4;
  const span = count + quiet * 2;

  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
      }
    }
  }

  return `<svg class="qr" viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges" role="img" aria-label="${escapeHtml(text)}">
  <rect width="${span}" height="${span}" fill="#fff"/>
  <path d="${path}" fill="#111827"/>
</svg>`;
}

const ICONS = {
  truck:
    '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  phone:
    '<path d="M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  parcel:
    '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
} as const;

function icon(name: keyof typeof ICONS): string {
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

/**
 * The order's product lines. Orders written before line items existed carry
 * only the summary columns, so they fall back to one synthetic line — the
 * sticker never has to know which era an order came from.
 */
function lines(order: Order): OrderItem[] {
  if (order.items.length > 0) return order.items;
  return [
    {
      id: 0,
      productId: null,
      productName: order.product,
      unitPrice: order.unitPrice,
      quantity: order.quantity,
      lineTotal: order.unitPrice * order.quantity,
    },
  ];
}

/**
 * One invoice, at either size. The 3 × 4 in label is the same document as the
 * A4 sheet — the .pptx structure, top to bottom — rather than a different
 * layout, so a courier and a customer read the same thing. It is built for a
 * 203 dpi thermal head rather than scaled down from A4 (which would drop the
 * body to ~5pt and turn Bengali conjuncts to mush): pure black on white,
 * nothing thinner than 0.3mm, no grey fills, and the totals pinned to the
 * foot so the due amount lands in the same spot on every parcel.
 */
function invoiceHtml(order: Order, date: string, size: StickerSize): string {
  const label = size === "label";
  const rows = lines(order);
  const subTotal = rows.reduce((sum, row) => sum + row.lineTotal, 0);
  const parcelId = order.courierConsignmentId || "N/A";

  return `
<article class="page${label ? " label" : ""}">
  <header class="head">
    <h1>${SHOP_NAME}</h1>
    <div class="meta">
      <div><span class="k">Date:</span><b>${escapeHtml(date)}</b></div>
      <div><span class="k">IV No:</span><b>${escapeHtml(order.orderNo)}</b></div>
    </div>
  </header>

  <section class="party">
    <div class="who">
      <div class="line">${icon("truck")}<span class="k">Courier</span><b>${escapeHtml(order.courierConsignmentId ? courierLabel(order) : "—")}</b></div>
      <div class="line">${icon("user")}<b class="lg">${escapeHtml(order.customerName || "Customer")}</b></div>
      <div class="line">${icon("phone")}<b class="lg mono">${escapeHtml(order.phone)}</b></div>
    </div>
    <div class="code">
      ${qrSvg(order.orderNo)}
      <div class="mono qr-label">${escapeHtml(order.orderNo)}</div>
    </div>
  </section>

  <section class="ship">
    <div class="field">
      <div class="k">${icon("pin")}Delivery address</div>
      <div class="v">${escapeHtml(order.address)}</div>
    </div>
    <div class="field">
      <div class="k">${icon("parcel")}Parcel ID</div>
      <div class="v mono">${escapeHtml(parcelId)}</div>
    </div>
  </section>

  <div class="items">
  <table>
    <thead>
      <tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (row) => `<tr>
        <td><span class="pn">${escapeHtml(row.productName)}</span></td>
        <td class="num">${row.quantity}</td>
        <td class="num">${row.unitPrice}</td>
        <td class="num">${row.lineTotal}</td>
      </tr>`
        )
        .join("\n      ")}
    </tbody>
  </table>
  </div>

  <section class="totals">
    <div class="t-row"><span>Sub Total</span><b>${subTotal}</b></div>
    <div class="t-row"><span>Delivery Fee</span><b>${DELIVERY_FEE}</b></div>
    <div class="due"><span>Due Amount</span><b>${order.total}</b></div>
  </section>

${label ? "" : `  <footer class="foot">Thank you for shopping with ${SHOP_NAME} &nbsp;•&nbsp; Cash on delivery</footer>`}
</article>`;
}

/**
 * The @font-face rules from our own stylesheets, copied into the print
 * document.
 *
 * The print window is a blank same-origin document, so it inherits none of the
 * page's CSS — and Bengali product names would fall back to whatever the OS
 * happens to have. Lifting the rules keeps next/font's self-hosted files in
 * play rather than reaching out to Google at print time (see lib/fonts.ts).
 * Their `url()`s are origin-relative, which the document's <base> resolves.
 */
function fontFaceCss(): string {
  const faces: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin stylesheet; nothing of ours lives there.
      continue;
    }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) faces.push(rule.cssText);
    }
  }
  return faces.join("\n");
}

export function buildStickerDocument(
  orders: Order[],
  size: StickerSize = "label"
): string {
  const date = printDate();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="${window.location.origin}/">
<title>Stickers — ${orders.length} order(s)</title>
<style>
${fontFaceCss()}

  @page { size: ${size === "a4" ? "A4" : "3in 4in"}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    /* Manrope has no Bengali glyphs, so product names fall through to Noto
       Sans Bengali — then to whatever Bengali face the OS ships, in case the
       @font-face lift above came up empty. */
    font-family: var(--font-manrope, "Manrope"), system-ui, -apple-system, "Segoe UI", Roboto,
      var(--font-bengali, "Noto Sans Bengali"), "Nirmala UI", "Kohinoor Bangla", "Bangla MN", sans-serif;
    color: #111827;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .page {
    display: flex; flex-direction: column;
    background: #fff;
    page-break-after: always; break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page:not(.label) { width: 210mm; height: 297mm; padding: 18mm 16mm; }
  .items { min-height: 0; }

  .ic { width: 1em; height: 1em; flex: none; color: #1B4332; }
  .mono { font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; }
  .head h1 { margin: 0; font-size: 27pt; font-weight: 800; color: #1B4332; letter-spacing: -0.01em; }
  .meta { text-align: right; font-size: 11pt; display: flex; flex-direction: column; gap: 1mm; }
  .meta .k { color: #6B7280; margin-right: 2mm; }
  .meta b { font-weight: 700; }

  .party { display: flex; justify-content: space-between; align-items: flex-start; gap: 10mm; margin-top: 9mm; }
  .who { display: flex; flex-direction: column; gap: 3.5mm; }
  .line { display: flex; align-items: center; gap: 2.5mm; font-size: 13pt; }
  .line .k { color: #6B7280; font-size: 11pt; }
  .line b { font-weight: 700; }
  .line .lg { font-size: 15pt; }
  .code { display: flex; flex-direction: column; align-items: center; gap: 1.5mm; }
  .qr { width: 34mm; height: 34mm; display: block; }
  .qr-label { font-size: 10pt; font-weight: 700; letter-spacing: 0.08em; color: #111827; }

  .ship { display: flex; gap: 10mm; margin-top: 9mm; }
  .ship .field { flex: 1; min-width: 0; }
  .ship .field + .field { flex: 0 0 46mm; }
  .ship .k { display: flex; align-items: center; gap: 2mm; font-size: 10pt; color: #6B7280; }
  .ship .v { margin-top: 1.5mm; font-size: 13pt; font-weight: 700; line-height: 1.35; }

  table { width: 100%; border-collapse: collapse; margin-top: 10mm; font-size: 12pt; }
  thead th {
    background: #E4F1E8; color: #1B4332;
    font-size: 9.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em;
    text-align: left; padding: 3mm 4mm;
  }
  thead th.num { text-align: right; }
  tbody td { padding: 5mm 4mm; vertical-align: top; line-height: 1.5; border-bottom: 0.3mm solid #D9DEDB; }
  tbody td.num { font-weight: 700; }

  .totals { margin-top: 6mm; margin-left: auto; width: 78mm; }
  .t-row { display: flex; justify-content: space-between; gap: 4mm; padding: 2mm 4mm; font-size: 11.5pt; }
  .t-row span { color: #6B7280; }
  .t-row b { font-weight: 700; font-variant-numeric: tabular-nums; }
  .due {
    display: flex; justify-content: space-between; align-items: baseline; gap: 4mm;
    margin-top: 2mm; padding: 4mm; border-radius: 1.5mm;
    background: #1B4332; color: #fff;
  }
  .due span { font-size: 12pt; font-weight: 600; }
  .due b { font-size: 17pt; font-weight: 800; font-variant-numeric: tabular-nums; }

  /* Sits just under the total rather than being pushed to the foot of the
     sheet — an invoice this short left a hand's width of blank in between. */
  .foot { margin-top: 10mm; text-align: center; font-size: 9.5pt; color: #6B7280; }


  /* --- 3 x 4 in thermal label: the same invoice, black only, tightened --- */
  .label { width: 3in; height: 4in; padding: 4mm; color: #000; }
  .label .ic, .label .k, .label .t-row span, .label .qr-label { color: #000; }
  .label .head { gap: 3mm; align-items: flex-start; }
  .label .head h1 { font-size: 13pt; color: #000; white-space: nowrap; }
  .label .meta { font-size: 7.5pt; gap: 0.5mm; white-space: nowrap; }
  .label .meta .k { margin-right: 1mm; }

  .label .party { margin-top: 2mm; gap: 3mm; }
  .label .who { gap: 1mm; min-width: 0; }
  .label .line { gap: 1.5mm; font-size: 8pt; }
  .label .line .k { font-size: 8pt; }
  /* The two fields a rider actually reads off the parcel. */
  .label .line .lg { font-size: 11pt; }
  .label .code { gap: 0; flex: none; }
  /* 18mm at 203 dpi is 144 dots across 29 modules — 5 dots a module,
     above the 4-dot floor where scanning starts to fail. */
  .label .qr { width: 18mm; height: 18mm; }
  /* The header's IV No is a centimetre above; the caption only cost rows. */
  .label .qr-label { display: none; }

  .label .ship { flex-direction: column; gap: 1mm; margin-top: 2mm; }
  .label .ship .field + .field { flex: none; display: flex; align-items: baseline; gap: 2mm; }
  .label .ship .k { font-size: 7pt; gap: 1.5mm; }
  .label .ship .v { margin-top: 0.5mm; font-size: 8.5pt; line-height: 1.3; }
  .label .ship .field + .field .v { margin-top: 0; }

  /* Absorbs the label's slack and hides an overrun, so a long order never
     pushes the totals off the sheet — the due amount matters more than a
     fourth product line. */
  .label .items { flex: 1; overflow: hidden; margin-top: 2mm; }
  .label table { margin-top: 0; font-size: 7.5pt; }
  .label thead th {
    background: none; color: #000; font-size: 6.5pt; letter-spacing: 0.06em;
    padding: 1mm 1.5mm; border-bottom: 0.3mm solid #000;
  }
  .label tbody td { padding: 1.2mm 1.5mm; line-height: 1.3; border-bottom-color: #000; }
  /* Bounds a row: a long Bengali combo name gets three lines, not six, so
     a second product still makes it onto the sheet. */
  .label .pn { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }

  .label .totals { margin-top: 1.5mm; width: 100%; }
  .label .t-row { padding: 0.5mm 1.5mm; font-size: 8pt; }
  .label .due {
    margin-top: 0.8mm; padding: 1mm 1.5mm; border-radius: 0;
    background: none; color: #000; border-top: 0.5mm solid #000;
  }
  .label .due span { font-size: 9pt; font-weight: 700; }
  .label .due b { font-size: 13pt; }

  @media screen {
    body { background: #e5e5e5; padding: 8mm 0; }
    .page { margin: 0 auto 8mm; box-shadow: 0 2px 12px rgba(0,0,0,0.18); }
  }
</style>
</head>
<body>
${orders
  .map((order) =>
    invoiceHtml(order, date, size))
  .join("\n")}
<script>
(function () {
  var printed = false;
  function go() {
    if (printed) return;
    printed = true;
    window.focus();
    window.print();
  }
  // Print once the Bengali face has actually loaded, so a product name is
  // never laid out in a fallback and reflowed mid-dialog. The timeout is the
  // backstop for a font that never resolves.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { setTimeout(go, 50); });
    setTimeout(go, 3000);
  } else {
    setTimeout(go, 300);
  }
})();
</script>
</body>
</html>`;
}

/** Open a print window with one sticker per order. Returns false if the
 * browser blocked the popup. */
export function printStickers(
  orders: Order[],
  size: StickerSize = "label"
): boolean {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return false;
  win.document.open();
  win.document.write(buildStickerDocument(orders, size));
  win.document.close();
  return true;
}
