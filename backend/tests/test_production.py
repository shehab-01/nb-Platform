"""
api.routers.production: how a production day's figures are worked out.

The server decides every total — line amounts, labour, the day's cost, jars,
cost per jar — from what was typed. No database needed.

Run from backend/:  python -m pytest tests -q
"""
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from api.models import ProductionDay
from api.routers.production import _apply, date_refusal, line_amount, totals
from api.schemas import ProductionDayIn, ProductionDayOut, ProductionItemIn, ProductionMaterialIn

# Each item's unit, as the store's item list gives it.
UNITS = {"Mustard oil": "L", "Others": None}


def day(**kw) -> ProductionDayIn:
    base = dict(
        male_cooks=6,
        male_rate=450,
        female_cooks=4,
        female_rate=400,
        gas_cost=6800,
        packaging_cost=8650,
        materials=[
            {"item": "Mustard oil", "quantity": "12", "unit_price": 220},
            {"item": "Others", "amount": 800},
        ],
        batches=[
            {"product": "Padmar Ilish", "patils": 1, "jars_per_patil": 200},
            {"product": "Gorur Mangsher", "patils": 2, "jars_per_patil": 200},
        ],
        misc=[{"purpose": "Transport", "amount": 2500}],
    )
    return ProductionDayIn(**(base | kw))


def test_a_line_is_quantity_times_price():
    assert line_amount(Decimal("12"), 220, None) == 2640


def test_a_fractional_line_rounds_half_up_to_whole_taka():
    assert line_amount(Decimal("1.5"), 75, None) == 113  # 112.5
    assert line_amount(Decimal("0.25"), 90, None) == 23  # 22.5


def test_a_typed_total_is_ignored_when_quantity_and_price_are_given():
    assert line_amount(Decimal("2"), 100, 999) == 200


def test_a_lump_sum_line_keeps_its_amount():
    assert line_amount(None, None, 800) == 800


def test_a_line_needs_a_price_or_a_total():
    with pytest.raises(ValidationError):
        ProductionMaterialIn(item="Salt", quantity="1")


def test_a_blank_item_is_refused():
    with pytest.raises(ValidationError):
        ProductionMaterialIn(item="   ", amount=10)


def test_the_days_figures():
    t = totals(day())
    assert t == {
        "materials_cost": 2640 + 800,
        "labour_cost": 6 * 450 + 4 * 400,
        "misc_cost": 2500,
        "total_cost": 3440 + 4300 + 6800 + 8650 + 2500,
        "patils": 3,
        "jars": 600,
    }


def test_a_day_without_a_product_is_refused():
    with pytest.raises(ValidationError):
        day(batches=[])


def test_applying_replaces_lines_and_stamps_the_store():
    row = ProductionDay()
    _apply(row, day(), 2, UNITS)
    assert [m.amount for m in row.materials] == [2640, 800]
    assert [m.unit for m in row.materials] == ["L", None]
    assert [b.jars for b in row.batches] == [200, 400]
    assert {x.store_id for x in [*row.materials, *row.batches, *row.misc]} == {2}
    assert [m.position for m in row.materials] == [0, 1]

    _apply(row, day(materials=[], misc=[]), 2, UNITS)
    assert row.materials == [] and row.misc == []
    assert row.materials_cost == 0 and row.total_cost == 4300 + 6800 + 8650


def test_shifts_are_kept_as_plain_json():
    row = ProductionDay()
    _apply(row, day(shifts=[{"starts": "08:00", "ends": "14:00", "cooks": 6}]), 2, UNITS)
    assert row.shifts == [{"starts": "08:00:00", "ends": "14:00:00", "cooks": 6}]


def test_cost_per_jar_is_worked_out_and_rounded():
    row = ProductionDay(day=datetime(2026, 9, 28).date(), updated_at=datetime.now(timezone.utc))
    _apply(row, day(), 2, UNITS)
    out = ProductionDayOut.model_validate(row)
    assert out.cost_per_jar == round(row.total_cost / 600, 2)


def test_an_items_unit_is_never_taken_from_the_browser():
    # The input has no unit at all; an extra field is simply ignored.
    m = ProductionMaterialIn(item="Salt", quantity="1", unit_price=20, unit="tonne")
    assert not hasattr(m, "unit")


def test_an_item_needs_a_known_unit():
    assert ProductionItemIn(name="  Mustard   oil ", unit="L").name == "Mustard oil"
    with pytest.raises(ValidationError):
        ProductionItemIn(name="Oil", unit="tonne")


TODAY = datetime(2026, 10, 10).date()
YESTERDAY = datetime(2026, 10, 9).date()


def refusal(**kw):
    base = dict(super_admin=False, day=TODAY, today=TODAY, new=True, moving=False)
    return date_refusal(**(base | kw))


def test_anyone_with_crm_records_today():
    assert refusal() is None


def test_only_a_super_admin_records_an_earlier_day():
    assert refusal(day=YESTERDAY) is not None
    assert refusal(day=YESTERDAY, super_admin=True) is None


def test_correcting_keeps_its_date_so_anyone_may():
    assert refusal(day=YESTERDAY, new=False) is None


def test_only_a_super_admin_moves_a_production():
    assert refusal(day=YESTERDAY, new=False, moving=True) is not None
    assert refusal(day=YESTERDAY, new=False, moving=True, super_admin=True) is None


def test_nobody_records_the_future():
    tomorrow = datetime(2026, 10, 11).date()
    assert refusal(day=tomorrow, super_admin=True) is not None
