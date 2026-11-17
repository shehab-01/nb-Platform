"""
api.routers.production_runs: how a batch production's figures are worked out,
when it may be closed, and what its slot invoice says. No database needed;
the PDF step (LibreOffice) is not run.

Run from backend/:  python -m pytest tests -q
"""
import io
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest
from docx import Document
from fastapi import HTTPException
from pydantic import ValidationError

from api import tenancy
from api.models import ProductionRun, ProductionSlot, UserRole
from api.routers.production_runs import (
    DEFAULT_SLOT_COSTS,
    _cost_rows,
    _only_batch,
    _slot_cost_rows,
    close_refusal,
    cost_amount,
    figures,
    reprice_slot,
    run_out,
    slot_cost_amount,
)
from api.schemas import ProductionRunIn, ProductionSlotCostIn, ProductionSlotIn
from api.services.production_invoice import invoice_context, rate, render_docx
from api.stores import StoreConfig

NOW = datetime(2026, 11, 20, 15, 30)


def order(**kw) -> ProductionRunIn:
    """Eco-Tine's sheet: 12,000 packets and what was bought for them."""
    base = dict(
        name="November run",
        opened_on=date(2026, 11, 17),
        units=12_000,
        pieces_per_packet=20,
        raw_kg="200",
        raw_cost=50_000,
        costs=[
            {"item": "Packet", "unit": "packet", "unit_price": "3.15", "follows_units": True},
            {"item": "3-packet combo box", "unit": "pcs", "quantity": "2000", "unit_price": "13"},
            {"item": "5-packet combo box", "unit": "pcs", "quantity": "1000", "unit_price": "20"},
            {"item": "Cigarette paper", "unit": "ream", "quantity": "5", "unit_price": "1600"},
            {"item": "Cigarette label", "unit": "kg", "quantity": "15", "unit_price": "1000"},
            {"item": "Glue", "unit": "pcs", "quantity": "15", "unit_price": "480"},
            {"item": "Not known yet", "unit": "pcs", "unit_price": "10"},
        ],
    )
    return ProductionRunIn(**(base | kw))


SLOT_COSTS = [
    {"label": "Labour charge", "basis": "per_1000_pieces", "rate": "400"},
    {"label": "Packet production", "basis": "per_packet", "rate": "4"},
    {"label": "Transport", "basis": "fixed", "amount": 1500},
    {"label": "Others", "basis": "fixed"},
]


def slot(run: ProductionRun, number: int, packets: int, day=date(2026, 11, 20)) -> ProductionSlot:
    body = ProductionSlotIn(received_on=day, packets=packets, costs=SLOT_COSTS)
    costs = _slot_cost_rows(body.costs, packets, run.pieces_per_packet, 1)
    s = ProductionSlot(
        id=number * 10,
        number=number,
        received_on=day,
        packets=packets,
        note=None,
        costs=costs,
        total_cost=sum(c.amount for c in costs),
        updated_at=NOW,
    )
    run.slots.append(s)
    return s


def run_from(body: ProductionRunIn) -> ProductionRun:
    return ProductionRun(
        id=5,
        store_id=1,
        name=body.name,
        opened_on=body.opened_on,
        units=body.units,
        pieces_per_packet=body.pieces_per_packet,
        raw_kg=body.raw_kg,
        raw_cost=body.raw_cost,
        costs=_cost_rows(body.costs, body.units, 1),
        slots=[],
        closed_early=False,
        updated_at=NOW,
    )


# --- Amounts ---------------------------------------------------------------------


def test_a_line_is_quantity_times_unit_price_keeping_paisa():
    assert cost_amount(Decimal("12000"), Decimal("3.15")) == 37_800
    assert cost_amount(Decimal("12000"), Decimal("3.50")) == 42_000


def test_a_line_rounds_half_up_to_whole_taka():
    assert cost_amount(Decimal("3"), Decimal("3.15")) == 9  # 9.45
    assert cost_amount(Decimal("1"), Decimal("2.50")) == 3


def test_a_blank_quantity_or_price_costs_nothing_yet():
    assert cost_amount(None, Decimal("13")) == 0
    assert cost_amount(Decimal("2000"), None) == 0


def test_labour_is_per_1000_pieces():
    # 3,000 packets × 20 pieces = 60,000 pieces; ৳400 per 1,000 = ৳24,000.
    assert slot_cost_amount("per_1000_pieces", Decimal("400"), None, 3000, 20) == 24_000
    assert slot_cost_amount("per_1000_pieces", Decimal("400"), None, 1, 20) == 8


def test_packet_making_is_per_packet():
    assert slot_cost_amount("per_packet", Decimal("4"), None, 3000, 20) == 12_000


def test_a_fixed_cost_is_the_amount_typed_and_a_rated_line_ignores_it():
    assert slot_cost_amount("fixed", None, 1500, 3000, 20) == 1500
    assert slot_cost_amount("fixed", None, None, 3000, 20) == 0
    assert slot_cost_amount("per_packet", Decimal("4"), 999, 10, 20) == 40
    assert slot_cost_amount("per_packet", None, 999, 10, 20) == 0


def test_the_packet_line_follows_the_order_whatever_is_sent():
    body = order(
        costs=[{"item": "Packet", "quantity": "5", "unit_price": "3.15", "follows_units": True}]
    )
    (line,) = _cost_rows(body.costs, body.units, 1)
    assert line.quantity == 12_000
    assert line.amount == 37_800


def test_a_fixed_line_keeps_no_rate():
    body = ProductionSlotIn(
        received_on=date(2026, 11, 20),
        packets=10,
        costs=[{"label": "Transport", "basis": "fixed", "rate": "5", "amount": 300}],
    )
    (line,) = _slot_cost_rows(body.costs, 10, 20, 1)
    assert line.rate is None and line.amount == 300


# --- A whole production -----------------------------------------------------------


def test_the_production_figures():
    run = run_from(order())
    # Materials: raw 50,000 + packets 37,800 + combos 26,000 + 20,000
    # + paper 8,000 + labels 15,000 + glue 7,200 (+ 0 for the blank line).
    materials = 50_000 + 37_800 + 26_000 + 20_000 + 8_000 + 15_000 + 7_200
    f = figures(run)
    assert f["materials_cost"] == materials
    assert f["received"] == 0 and f["pending"] == 12_000
    assert f["cost_per_packet"] is None and f["cost_per_piece"] is None

    slot(run, 1, 3000)
    f = figures(run)
    # 24,000 labour + 12,000 packet making + 1,500 transport.
    assert f["slots_cost"] == 37_500
    assert f["received"] == 3000 and f["pending"] == 9000
    assert f["pieces_received"] == 60_000
    assert f["total_cost"] == materials + 37_500
    assert f["cost_per_packet"] == round((materials + 37_500) / 3000, 2)

    slot(run, 2, 4500)
    slot(run, 3, 4500)
    f = figures(run)
    assert f["received"] == 12_000 and f["pending"] == 0
    # Each 4,500: ৳36,000 labour + ৳18,000 packet making + ৳1,500 transport.
    assert f["slots_cost"] == 37_500 + 2 * 55_500
    assert f["slots"] == 3


def test_the_raw_material_counts_in_full_whatever_was_used():
    run = run_from(order())
    before = figures(run)["total_cost"]
    run.raw_used_kg = Decimal("150")
    assert figures(run)["total_cost"] == before


def test_changing_pieces_per_packet_reprices_labour():
    run = run_from(order())
    s = slot(run, 1, 3000)
    run.pieces_per_packet = 10
    reprice_slot(s, run.pieces_per_packet)
    # 30,000 pieces × ৳400 / 1,000 = 12,000; packet making and transport unchanged.
    assert s.total_cost == 12_000 + 12_000 + 1500


def test_the_production_as_the_page_reads_it():
    run = run_from(order())
    slot(run, 1, 3000)
    out = run_out(run)
    assert out.received == 3000 and out.pending == 9000
    assert out.costs[0].quantity == 12_000 and out.costs[0].unit_price == 3.15
    assert out.slot_list[0].pieces == 60_000
    assert [c.amount for c in out.slot_list[0].costs] == [24_000, 12_000, 1500, 0]
    assert out.closed is False


# --- Closing ---------------------------------------------------------------------------


def test_closing_once_nothing_is_pending_needs_nobody_special():
    assert close_refusal(pending=0, early=False, super_admin=False) is None


def test_only_a_super_admin_closes_early_and_only_when_asked():
    assert "super admin" in close_refusal(pending=9000, early=True, super_admin=False)
    assert "confirm" in close_refusal(pending=9000, early=False, super_admin=True)
    assert close_refusal(pending=9000, early=True, super_admin=True) is None


# --- Mode ------------------------------------------------------------------------------


def _ctx(mode: str) -> tenancy.StoreContext:
    store = StoreConfig(
        id=1, slug="e", name="Eco", template="classic", currency="BDT", production_mode=mode
    )
    return tenancy.StoreContext(store=store, role="owner", user=SimpleNamespace(id=1))


def test_batch_pages_are_refused_to_a_cooking_store():
    with pytest.raises(HTTPException) as err:
        _only_batch(_ctx("cooking"))
    assert err.value.status_code == 409
    assert _only_batch(_ctx("batch")).store.production_mode == "batch"


def test_super_admins_see_each_stores_mode():
    admin = SimpleNamespace(id=1, email="boss@example.com", role=UserRole.super_admin)
    stores_ = [
        tenancy.StoreAccess(1, "a", "A", "", True),
        tenancy.StoreAccess(2, "e", "Eco", "", True, production_mode="batch"),
    ]
    got = {a.store_id: a.production_mode for a in tenancy.accessible(admin, [], stores_)}
    assert got == {1: "cooking", 2: "batch"}


# --- Validation ------------------------------------------------------------------------


def test_an_order_needs_packets_and_a_name():
    with pytest.raises(ValidationError):
        order(units=0)
    with pytest.raises(ValidationError):
        order(name="   ")


def test_a_slot_cost_basis_is_one_of_three():
    with pytest.raises(ValidationError):
        ProductionSlotCostIn(label="Labour", basis="per_hour", rate="5")


def test_the_new_units_are_accepted():
    order(costs=[{"item": "Paper", "unit": "ream"}, {"item": "Tape", "unit": "roll"}])


def test_the_built_in_slot_costs_are_eco_tines_rates():
    rates = {c.label: (c.basis, c.rate) for c in DEFAULT_SLOT_COSTS}
    assert rates["Labour charge"] == ("per_1000_pieces", 400)
    assert rates["Packet production"] == ("per_packet", 4)


# --- Invoice ---------------------------------------------------------------------------


def test_rates_keep_paisa_only_when_they_have_some():
    assert rate(Decimal("400")) == "৳400"
    assert rate(Decimal("3.5")) == "৳3.50"
    assert rate(None) == "—"


def test_the_invoice_says_what_was_received_and_what_to_pay():
    run = run_from(order())
    slot(run, 1, 3000)
    second = slot(run, 2, 4000, day=date(2026, 11, 24))
    ctx = invoice_context(run, second, store="Eco-Tine", generated_by="Shehab", now=NOW)
    assert ctx["slot"] == "Slot 2"
    assert ctx["received_on"] == "24 Nov 2026"
    assert ctx["packets"] == "4,000" and ctx["pieces"] == "80,000"
    assert ctx["received_so_far"] == "7,000" and ctx["pending_after"] == "5,000"
    # The empty "Others" line is left off; labour reads as it was worked out.
    assert [r["label"] for r in ctx["rows"]] == ["Labour charge", "Packet production", "Transport"]
    assert ctx["rows"][0]["how"] == "80,000 pieces × ৳400 per 1,000"
    assert ctx["rows"][0]["amount"] == "৳32,000"
    assert ctx["total"] == "৳49,500"
    assert ctx["filename"] == "production-5-slot-2.pdf"


def test_the_invoice_document_builds():
    run = run_from(order())
    s = slot(run, 1, 3000)
    ctx = invoice_context(run, s, store="Eco-Tine", generated_by="Shehab", now=NOW)
    doc = Document(io.BytesIO(render_docx(ctx)))
    text = "\n".join(
        cell.text for t in doc.tables for r in t.rows for cell in r.cells
    )
    for expected in ("Slot 1", "Total payable", "৳37,500", "Prepared by", "Approved by"):
        assert expected in text
