"""
api.services.production_report: what a production report says, and that the
Word template fills in. The PDF step (LibreOffice) is not run here.

Run from backend/:  python -m pytest tests -q
"""
import io
from datetime import date, datetime, time
from decimal import Decimal

from docx import Document

from api.models import ProductionDay
from api.routers.production import _apply
from api.schemas import ProductionDayIn
from api.services.production_report import (
    clock,
    inr,
    quantity,
    render_docx,
    report_context,
    taka_paisa,
)


def test_indian_digit_grouping():
    assert inr(0) == "0"
    assert inr(999) == "999"
    assert inr(1000) == "1,000"
    assert inr(48750) == "48,750"
    assert inr(1234567) == "12,34,567"
    assert inr(-123456) == "-1,23,456"


def test_cost_per_jar_keeps_paisa():
    assert taka_paisa(40.625) in ("৳40.62", "৳40.63")
    assert taka_paisa(123456.5) == "৳1,23,456.50"


def test_times_and_quantities():
    assert clock(time(8, 0)) == "8:00 AM"
    assert clock("14:30:00") == "2:30 PM"
    assert clock(None) == "—"
    assert quantity(Decimal("12.000"), "L") == "12 লিটার"
    assert quantity(Decimal("1.500"), "kg") == "1.5 কেজি"
    assert quantity(None, "kg") == "—"


def a_day() -> ProductionDay:
    row = ProductionDay(day=date(2026, 10, 9), updated_at=datetime(2026, 10, 9, 17, 0))
    body = ProductionDayIn(
        starts_at="08:00",
        ends_at="16:00",
        shifts=[{"starts": "08:00", "ends": "14:00", "cooks": 6}],
        male_cooks=6,
        male_rate=450,
        female_cooks=4,
        female_rate=400,
        gas_cost=6800,
        packaging_cost=8650,
        materials=[
            {"item": "সরিষার তেল", "quantity": "12", "unit_price": 220},
            {"item": "Salt & pepper", "amount": 800},
        ],
        batches=[{"product": "Padmar Ilish", "patils": 1, "jars_per_patil": 200}],
        misc=[{"purpose": "Transport", "amount": 2500, "note": "van"}],
    )
    _apply(row, body, 2, {"সরিষার তেল": "L", "Salt & pepper": None})
    return row


def context():
    return report_context(
        a_day(), store="Nature Bazar", generated_by="Shohan", now=datetime(2026, 10, 9, 20, 5)
    )


def test_the_report_figures():
    c = context()
    assert c["date"] == "Fri, 9 Oct 2026"
    assert c["time"] == "8:00 AM – 4:00 PM"
    assert c["total_cost"] == "৳25,690"  # 3,440 + 4,300 + 6,800 + 8,650 + 2,500
    assert c["jars"] == "200"
    assert c["materials"][0]["quantity"] == "12 লিটার"
    assert c["materials"][0]["amount"] == "৳2,640"
    assert c["shifts"][0] == {"name": "Shift 1", "time": "8:00 AM – 2:00 PM", "cooks": "6 জন"}
    assert [o["label"] for o in c["other_costs"]] == ["Gas / fuel", "Packaging", "Transport"]
    assert c["note"] == "—"


def test_empty_lists_still_read():
    row = a_day()
    row.shifts = []
    row.materials = []
    c = report_context(row, store="S", generated_by="X", now=datetime(2026, 10, 9))
    assert c["shifts"][0]["time"] == "No shifts recorded"
    assert c["materials"][0]["item"] == "No bazar recorded"


def test_the_template_fills_in():
    text = "\n".join(
        cell.text
        for table in Document(io.BytesIO(render_docx(context()))).tables
        for r in table.rows
        for cell in r.cells
    )
    assert "Nature Bazar" in text
    assert "সরিষার তেল" in text
    # Escaped going in, plain coming out: the ampersand survived.
    assert "Salt & pepper" in text
    # Every tag was filled.
    assert "{{" not in text and "{%" not in text
