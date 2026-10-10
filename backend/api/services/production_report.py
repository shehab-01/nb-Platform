"""
A saved production as a PDF report.

The look lives in a Word template (api/reports/production_day.docx, made by
scripts/make_production_report_template.py and editable in Word): docxtpl
fills it with the day's figures, then LibreOffice, headless, turns it into a
PDF. Everything shown is formatted here — taka with Indian digit grouping,
units in Bangla — so the template holds only placeholders.

LibreOffice is slow to start and keeps a profile it does not like sharing,
so each conversion gets its own throwaway profile and at most two run at
once; the work happens off the event loop.
"""
from __future__ import annotations

import asyncio
import io
import shutil
import subprocess
import tempfile
from datetime import datetime, time
from decimal import Decimal
from pathlib import Path

from docxtpl import DocxTemplate
from fastapi.concurrency import run_in_threadpool

from api.models import ProductionDay

TEMPLATE = Path(__file__).resolve().parent.parent / "reports" / "production_day.docx"

# How a unit code reads, as the admin shows it (lib/api.ts UNIT_LABELS).
UNIT_LABELS = {
    "kg": "কেজি",
    "g": "গ্রাম",
    "L": "লিটার",
    "ml": "মিলি",
    "pcs": "পিস",
    "dozen": "ডজন",
    "packet": "প্যাকেট",
    "bottle": "বোতল",
}

_SLOTS = asyncio.Semaphore(2)
_TIMEOUT = 120  # seconds; a first run also builds the profile


class ReportUnavailable(Exception):
    """The PDF could not be made (LibreOffice missing, failed or too slow)."""


# --- Formatting ------------------------------------------------------------------


def inr(n: int) -> str:
    """Indian digit grouping: 1234567 → "12,34,567"."""
    sign, digits = ("-", str(-n)) if n < 0 else ("", str(n))
    if len(digits) <= 3:
        return sign + digits
    head, tail = digits[:-3], digits[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return sign + ",".join(groups + [tail])


def taka(n: int) -> str:
    return f"৳{inr(n)}"


def taka_paisa(x: float) -> str:
    """Cost per jar keeps its paisa: ৳40.63."""
    whole, frac = f"{x:.2f}".split(".")
    return f"৳{inr(int(whole))}.{frac}"


def clock(t: time | str | None) -> str:
    """"8:00 AM" for a time or "08:00[:00]"; "—" when unset."""
    if t is None or t == "":
        return "—"
    if isinstance(t, str):
        h, m = (int(x) for x in t.split(":")[:2])
        t = time(h, m)
    return t.strftime("%I:%M %p").lstrip("0")


def quantity(q: Decimal | float | None, unit: str | None) -> str:
    if q is None:
        return "—"
    text = format(Decimal(str(q)).normalize(), "f")
    return f"{text} {UNIT_LABELS.get(unit or '', unit or '')}".strip()


def share(part: int, total: int) -> str:
    return f"{part / total * 100:.1f}%" if total else "—"


# --- The report ----------------------------------------------------------------------


def report_context(
    day: ProductionDay, *, store: str, generated_by: str, now: datetime
) -> dict:
    """Everything the template shows, as text. Pure: the day as saved in,
    strings out."""
    span = "—"
    if day.starts_at or day.ends_at:
        span = f"{clock(day.starts_at)} – {clock(day.ends_at)}"

    shifts = [
        {
            "name": f"Shift {i + 1}",
            "time": f"{clock(s.get('starts'))} – {clock(s.get('ends'))}",
            "cooks": "—" if s.get("cooks") is None else f"{s['cooks']} জন",
        }
        for i, s in enumerate(day.shifts or [])
    ] or [{"name": "—", "time": "No shifts recorded", "cooks": ""}]

    materials = [
        {
            "no": str(i + 1),
            "item": m.item,
            "quantity": quantity(m.quantity, m.unit),
            "unit_price": "—" if m.unit_price is None else taka(m.unit_price),
            "amount": taka(m.amount),
        }
        for i, m in enumerate(day.materials)
    ] or [{"no": "", "item": "No bazar recorded", "quantity": "", "unit_price": "", "amount": ""}]

    batches = [
        {
            "product": b.product,
            "patils": inr(b.patils),
            "per_patil": inr(b.jars_per_patil),
            "jars": inr(b.jars),
        }
        for b in day.batches
    ]

    other_costs = [
        {"label": "Gas / fuel", "note": "", "amount": taka(day.gas_cost)},
        {"label": "Packaging", "note": "", "amount": taka(day.packaging_cost)},
    ] + [{"label": m.purpose, "note": m.note or "", "amount": taka(m.amount)} for m in day.misc]

    total = day.total_cost
    parts = [
        ("Raw materials (bazar)", day.materials_cost),
        ("Labour cost (male + female)", day.labour_cost),
        ("Gas / fuel", day.gas_cost),
        ("Packaging", day.packaging_cost),
        ("Miscellaneous", day.misc_cost),
    ]

    return {
        "store": store,
        "date": day.day.strftime("%a, %d %b %Y").replace(" 0", " "),
        "time": span,
        "jars": inr(day.jars),
        "patils": inr(day.patils),
        "total_cost": taka(total),
        "cost_per_jar": taka_paisa(total / day.jars) if day.jars else "—",
        "male_cooks": inr(day.male_cooks),
        "male_rate": taka(day.male_rate),
        "male_total": taka(day.male_cooks * day.male_rate),
        "female_cooks": inr(day.female_cooks),
        "female_rate": taka(day.female_rate),
        "female_total": taka(day.female_cooks * day.female_rate),
        "total_cooks": inr(day.male_cooks + day.female_cooks),
        "labour_cost": taka(day.labour_cost),
        "shifts": shifts,
        "materials": materials,
        "materials_cost": taka(day.materials_cost),
        "batches": batches,
        "other_costs": other_costs,
        "breakdown": [
            {"label": label, "amount": taka(amount), "share": share(amount, total)}
            for label, amount in parts
        ],
        "note": day.note or "—",
        "generated_at": now.strftime("%d %b %Y, %I:%M %p").lstrip("0").replace(" 0", " "),
        "generated_by": generated_by,
    }


def render_docx(context: dict) -> bytes:
    """The template filled in, as a .docx file's bytes."""
    doc = DocxTemplate(TEMPLATE)
    # Escaped, so an item called "Salt & pepper" cannot break the document.
    doc.render(context, autoescape=True)
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def docx_to_pdf(docx: bytes) -> bytes:
    """A .docx file's bytes as a PDF's, through headless LibreOffice."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if soffice is None:
        raise ReportUnavailable("Reports need LibreOffice, which is not installed here")
    with tempfile.TemporaryDirectory(prefix="report-") as tmp:
        folder = Path(tmp)
        src = folder / "report.docx"
        src.write_bytes(docx)
        try:
            subprocess.run(
                [
                    soffice,
                    # Its own profile: two conversions must not share one.
                    f"-env:UserInstallation={(folder / 'profile').as_uri()}",
                    "--headless",
                    "--norestore",
                    "--nologo",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(folder),
                    str(src),
                ],
                check=True,
                capture_output=True,
                timeout=_TIMEOUT,
            )
        except subprocess.TimeoutExpired as err:
            raise ReportUnavailable("The report took too long to make; try again") from err
        except subprocess.CalledProcessError as err:
            raise ReportUnavailable("The report could not be made") from err
        pdf = folder / "report.pdf"
        if not pdf.exists():
            raise ReportUnavailable("The report could not be made")
        return pdf.read_bytes()


async def production_pdf(context: dict) -> bytes:
    """The report as a PDF, made off the event loop, two at a time at most."""
    async with _SLOTS:
        return await run_in_threadpool(lambda: docx_to_pdf(render_docx(context)))
