"""
One slot of a batch production as a PDF invoice: what was received and
what to pay for it, with space at the foot to sign.

Built here with python-docx in the house style (api.services.docx_style),
like the expense report, and turned into a PDF by LibreOffice through
api.services.production_report (its throwaway profile, its limit of two at
once). Nothing names who made the packets: the invoice is the store's own
record of a delivery.
"""
from __future__ import annotations

import io
from datetime import date, datetime
from decimal import Decimal

from docx import Document
from docx.enum.table import WD_ROW_HEIGHT_RULE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt
from fastapi.concurrency import run_in_threadpool

from api.models import ProductionRun, ProductionSlot
from api.services import production_report
from api.services.docx_style import (
    MUTED,
    TOTAL_FILL,
    fixed,
    heading,
    keep_rows_whole,
    page,
    row,
    table,
    write,
)
from api.services.production_report import inr, taka

# #, cost, how it was worked out, amount: 17.8 cm inside the margins.
WIDTHS = [0.8, 5.0, 9.0, 3.0]
RIGHT = {3}
SIGN_WIDTHS = [5.6, 0.5, 5.6, 0.5, 5.6]
SIGNATURES = ("Prepared by", "Received by", "Approved by")


def _date(d: date) -> str:
    return d.strftime("%d %b %Y").lstrip("0")


def rate(x: Decimal | float | None) -> str:
    """A rate with its paisa only when it has some: ৳400, ৳3.50."""
    if x is None:
        return "—"
    x = Decimal(str(x))
    if x == x.to_integral_value():
        return taka(int(x))
    whole, frac = f"{x:.2f}".split(".")
    return f"৳{inr(int(whole))}.{frac}"


def calculation(basis: str, line_rate, packets: int, pieces: int) -> str:
    """How a slot cost was worked out, in words the reader can check."""
    if basis == "per_1000_pieces":
        return f"{inr(pieces)} pieces × {rate(line_rate)} per 1,000"
    if basis == "per_packet":
        return f"{inr(packets)} packets × {rate(line_rate)}"
    return "Fixed amount"


def invoice_context(
    run: ProductionRun, slot: ProductionSlot, *, store: str, generated_by: str, now: datetime
) -> dict:
    """Everything the invoice shows, as text. Pure."""
    pieces = slot.packets * run.pieces_per_packet
    # Received up to and including this slot, as it stood when it arrived.
    so_far = sum(s.packets for s in run.slots if s.number <= slot.number)
    lines = [c for c in slot.costs if c.amount or c.basis != "fixed"]
    return {
        "store": store,
        "production": run.name,
        "opened_on": _date(run.opened_on),
        "slot": f"Slot {slot.number}",
        "received_on": _date(slot.received_on),
        "packets": inr(slot.packets),
        "pieces": inr(pieces),
        "pieces_per_packet": str(run.pieces_per_packet),
        "order": inr(run.units),
        "received_so_far": inr(so_far),
        "pending_after": inr(max(run.units - so_far, 0)),
        "rows": [
            {
                "no": str(i + 1),
                "label": c.label,
                "how": calculation(c.basis, c.rate, slot.packets, pieces),
                "amount": taka(c.amount),
            }
            for i, c in enumerate(lines)
        ],
        "total": taka(slot.total_cost),
        "note": slot.note or "",
        "generated_at": now.strftime("%d %b %Y, %I:%M %p").lstrip("0").replace(" 0", " "),
        "generated_by": generated_by,
        "filename": f"production-{run.id}-slot-{slot.number}.pdf",
    }


def render_docx(context: dict) -> bytes:
    """The invoice, as a .docx file's bytes."""
    doc = Document()
    page(doc)

    top = doc.add_table(rows=1, cols=2)
    fixed(top, [11.8, 6])
    left, right = top.rows[0].cells
    left.width, right.width = Cm(11.8), Cm(6)
    write(left, context["store"], bold=True, size=16)
    run = left.add_paragraph().add_run("Production invoice")
    run.font.size = Pt(11)
    run.font.color.rgb = MUTED
    write(right, context["slot"], bold=True, size=13, right=True)
    p = right.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = p.add_run(f"Received {context['received_on']}")
    run.font.color.rgb = MUTED

    heading(doc, "Delivery")
    facts = table(doc, ["Production", "Opened", "Packets received", "Pieces"], [6.2, 3.4, 4.2, 4.0], {2, 3})
    row(
        facts,
        [
            context["production"],
            context["opened_on"],
            context["packets"],
            f"{context['pieces']} ({context['pieces_per_packet']} per packet)",
        ],
        [6.2, 3.4, 4.2, 4.0],
        {2, 3},
    )
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    run = p.add_run(
        f"Order {context['order']} packets · received so far {context['received_so_far']}"
        f" · pending {context['pending_after']}"
    )
    run.font.size = Pt(8.5)
    run.font.color.rgb = MUTED

    heading(doc, "Charges")
    t = table(doc, ["#", "Cost", "Worked out as", "Amount"], WIDTHS, RIGHT)
    for r in context["rows"]:
        row(t, [r["no"], r["label"], r["how"], r["amount"]], WIDTHS, RIGHT)
    row(t, ["", "Total payable", "", context["total"]], WIDTHS, RIGHT, fill=TOTAL_FILL, bold=True)
    keep_rows_whole(t)

    if context["note"]:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        run = p.add_run(f"Note: {context['note']}")
        run.font.size = Pt(9)

    # Three boxes to sign, side by side, with a gap between them.
    spacer = doc.add_paragraph()
    spacer.paragraph_format.space_before = Pt(36)
    signs = doc.add_table(rows=2, cols=len(SIGN_WIDTHS))
    signs.style = "Table Grid"
    fixed(signs, SIGN_WIDTHS)
    signs.rows[0].height = Cm(2.2)
    signs.rows[0].height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
    labels = iter(SIGNATURES)
    for i, w in enumerate(SIGN_WIDTHS):
        for r in signs.rows:
            r.cells[i].width = Cm(w)
        if i % 2:
            # The gaps: no borders, so the boxes stand apart.
            for r in signs.rows:
                _no_borders(r.cells[i])
            continue
        write(signs.rows[1].cells[i], next(labels), size=8.5, color=MUTED)
    keep_rows_whole(signs)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    run = p.add_run(f"Generated {context['generated_at']} by {context['generated_by']}")
    run.font.size = Pt(8)
    run.font.color.rgb = MUTED

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def _no_borders(cell) -> None:
    tcpr = cell._tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for side in ("top", "left", "bottom", "right"):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:val"), "nil")
        borders.append(el)
    tcpr.append(borders)


async def invoice_pdf(context: dict) -> bytes:
    """The invoice as a PDF, made off the event loop, sharing the reports'
    limit on LibreOffice runs."""
    async with production_report.SLOTS:
        return await run_in_threadpool(
            lambda: production_report.docx_to_pdf(render_docx(context))
        )
