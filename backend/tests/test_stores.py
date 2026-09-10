"""api.stores: hostname normalisation and the resolution cache.

Run from backend/:  python -m pytest tests -q
"""
import pytest

from api import stores
from api.stores import StoreConfig, normalise_host


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("store1.nb.local", "store1.nb.local"),
        ("Store1.NB.Local:8090", "store1.nb.local"),
        ("naturebazar.xyz.", "naturebazar.xyz"),
        ("  admin.nb.local:8090 , 10.0.0.1", "admin.nb.local"),
        ("[::1]:8090", "::1"),
        ("localhost:8090", "localhost"),
        ("", None),
        (None, None),
        (":8090", None),
    ],
)
def test_normalise_host(raw, expected):
    assert normalise_host(raw) == expected


def _cfg(slug="s1", host="s1.test"):
    return StoreConfig(id=1, slug=slug, name="S", template="classic", currency="BDT", host=host)


def test_cache_hits_until_ttl(monkeypatch):
    cache = stores._Cache(ttl=10)
    now = [1000.0]
    monkeypatch.setattr(stores.time, "monotonic", lambda: now[0])
    assert cache.get("a") == (False, None)
    cache.put("a", _cfg())
    hit, value = cache.get("a")
    assert hit and value.slug == "s1"
    now[0] += 9.9
    assert cache.get("a")[0] is True
    now[0] += 0.2
    assert cache.get("a") == (False, None)


def test_cache_remembers_misses():
    cache = stores._Cache(ttl=10)
    cache.put("unknown.example", None)
    assert cache.get("unknown.example") == (True, None)


def test_cache_is_bounded():
    cache = stores._Cache(ttl=10)
    for i in range(10_000):
        cache.put(f"h{i}", None)
    cache.put("one-more", None)
    assert len(cache._entries) == 1


def test_invalidate_clears_both_caches():
    stores._by_host.put("x.test", _cfg())
    stores._by_slug.put("x", _cfg())
    stores.invalidate()
    assert stores._by_host.get("x.test") == (False, None)
    assert stores._by_slug.get("x") == (False, None)


def test_content_url_maps_media_paths():
    from api.stores import content_url

    assert content_url("stores/2/abc.jpg") == "/media/stores/2/abc.jpg"
    assert content_url("/campaign.jpg") == "/campaign.jpg"
