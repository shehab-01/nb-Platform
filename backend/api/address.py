"""
What counts as a usable delivery address on the storefront.

Customers were submitting a single word ("Dhaka") or just a number, which no
courier can deliver to and which costs a confirmation call to fix. The rule is
deliberately loose: at least three words, and not only numbers. Applied only
when an order is actually placed; autosaved drafts keep whatever was typed.
The browser mirrors this rule in lib/address.ts.
"""
import re

ADDRESS_MIN_WORDS = 3
ADDRESS_RULE = (
    f"Address must have at least {ADDRESS_MIN_WORDS} words (house/road, area, "
    "district) and cannot be only numbers"
)

# A word is a run of non-space characters containing a letter or a digit, so
# stray punctuation ("-", ",") does not count as one. Bangla letters and
# digits (০-৯) count like Latin ones.
_WORD = re.compile(r"\S*[^\W_]\S*")
_LETTER = re.compile(r"[^\W\d_]")


def address_words(value: str) -> list[str]:
    """The countable words of an address."""
    return _WORD.findall(value or "")


def valid_address(value: str) -> bool:
    words = address_words(value)
    if len(words) < ADDRESS_MIN_WORDS:
        return False
    return any(_LETTER.search(word) for word in words)
