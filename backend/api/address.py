"""
What counts as a usable delivery address on the storefront.

Customers were submitting just a number, which no courier can deliver to and
which costs a confirmation call to fix. The rule is deliberately loose: at
least one word, and not only numbers. A single word ("Dhaka") is accepted on
purpose — a stricter minimum turned real orders away. Applied only
when an order is actually placed; autosaved drafts keep whatever was typed.
The browser mirrors this rule in lib/address.ts.
"""
import re

ADDRESS_MIN_WORDS = 1
ADDRESS_RULE = (
    "Address must contain at least one word (e.g. area or district) "
    "and cannot be only numbers"
)

# A word is a run of characters containing a letter or a digit, broken by
# spaces or by the separators people type in place of them ("khairtul,03,
# tongi" is three words). Stray punctuation ("-", ",") does not count as one.
# Bangla letters and digits (০-৯) count like Latin ones; । is the Bangla
# full stop. Keep in step with lib/address.ts.
_WORD = re.compile(r"[^\s,;/|।]*[^\W_][^\s,;/|।]*")
_LETTER = re.compile(r"[^\W\d_]")


def address_words(value: str) -> list[str]:
    """The countable words of an address."""
    return _WORD.findall(value or "")


def valid_address(value: str) -> bool:
    words = address_words(value)
    if len(words) < ADDRESS_MIN_WORDS:
        return False
    return any(_LETTER.search(word) for word in words)
