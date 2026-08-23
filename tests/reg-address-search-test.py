from __future__ import annotations

from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "source" / "application" / "integrations" / "reg-vps" / "server" / "server.py"

psycopg2 = types.ModuleType("psycopg2")
extras = types.ModuleType("psycopg2.extras")
extras.Json = lambda value: value
psycopg2.extras = extras
sys.modules["psycopg2"] = psycopg2
sys.modules["psycopg2.extras"] = extras

SPEC = importlib.util.spec_from_file_location("justfun_reg_address_server", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(SERVER)


def valid_payload(**overrides):
    payload = {
        "request_id": "map-address-12345",
        "query": "Лен. обл., Всеволжск, ул. Центральная, д. 7",
        "preferred_region": "Ленинградская область",
        "language": "ru",
        "limit": 3,
        "client_version": "7.8.3",
        "address_contract": 1,
        "interaction": "autocomplete",
    }
    payload.update(overrides)
    return payload


def row(
    internal_id: str,
    *,
    display_name: str,
    text_score: float,
    region: str = "Ленинградская область",
    fias_id: str = "",
    source_name: str = "dadata",
    source_id: str | None = None,
    latitude: float | None = 60.0,
    longitude: float | None = 30.0,
):
    return {
        "internal_id": internal_id,
        "display_name": display_name,
        "object_type": "house",
        "region": region,
        "district": "Всеволожский район",
        "settlement": "Всеволожск",
        "territory": "",
        "street": "Центральная улица",
        "house": "д 7",
        "postal_code": "188640",
        "latitude": latitude,
        "longitude": longitude,
        "coordinate_accuracy": "building",
        "fias_id": fias_id,
        "source_name": source_name,
        "source_id": source_id or internal_id,
        "source_version": "suggestions-api-4_1",
        "source_date": datetime(2026, 8, 23, tzinfo=timezone.utc).date(),
        "official_status": bool(fias_id),
        "provider_warnings": [],
        "text_score": text_score,
    }


def dadata_suggestion():
    return {
        "value": "Ленинградская обл, г Всеволожск, ул Центральная, д 7",
        "unrestricted_value": "188640, Ленинградская обл, г Всеволожск, ул Центральная, д 7",
        "data": {
            "postal_code": "188640",
            "region_with_type": "Ленинградская обл",
            "area_with_type": "Всеволожский р-н",
            "city_with_type": "г Всеволожск",
            "street_with_type": "ул Центральная",
            "house_type": "д",
            "house": "7",
            "fias_id": "f26b876b-6857-4951-b060-ec6559f04a9a",
            "fias_level": "8",
            "fias_actuality_state": "0",
            "geo_lat": "60.0191",
            "geo_lon": "30.6456",
            "qc_geo": "0",
        },
    }


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return self.payload


class AddressSearchTests(unittest.TestCase):
    def setUp(self):
        SERVER.MAP_CACHE.clear()

    def test_normalization_covers_small_settlements_and_land_plots(self):
        self.assertEqual(
            SERVER.normalize_address_text("Лен. обл., С.Н.Т. Ромашка, массив Мшинская, уч. 14"),
            "ленинградская область снт ромашка массив мшинская участок 14",
        )
        self.assertEqual(SERVER.normalize_address_text("Д.Н.Т. Озеро"), "днт озеро")
        self.assertEqual(SERVER.normalize_address_text("Д.Н.П. Сосны"), "днп сосны")
        self.assertEqual(SERVER.normalize_address_text("пр-д Лесной, корп. 2, стр. 1"), "проезд лесной корпус 2 строение 1")

    def test_contract_is_strict_and_versioned(self):
        parsed = SERVER.validate_address_search_payload(valid_payload())
        self.assertEqual(parsed["limit"], 3)
        self.assertEqual(parsed["interaction"], "autocomplete")
        self.assertEqual(parsed["normalized_region"], "ленинградская область")
        for invalid in (
            {"limit": 2}, {"limit": 10}, {"address_contract": 2}, {"request_id": "bad"},
            {"language": "en"}, {"client_version": "latest"}, {"query": ".."}, {"interaction": "background"},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(SERVER.ApiError):
                SERVER.validate_address_search_payload(valid_payload(**invalid))

    def test_ranking_deduplicates_sources_and_never_fills_to_three(self):
        request = SERVER.validate_address_search_payload(valid_payload())
        rows = [
            row("dadata:1", display_name="Всеволожск, Центральная улица, дом 7", text_score=0.96, fias_id="fias-1"),
            row("other:2", display_name="Всеволожск, Центральная улица, дом 7", text_score=0.92, fias_id="fias-1", source_name="other", source_id="W2"),
            row("dadata:3", display_name="Москва, Центральная улица, дом 7", text_score=0.58, region="Москва", fias_id="fias-3"),
            row("dadata:4", display_name="Случайный адрес", text_score=0.1, region="Тверская область"),
        ]
        results = SERVER.rank_address_rows(rows, request)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["id"], "dadata:1")
        self.assertEqual(results[0]["fias_id"], "fias-1")
        self.assertEqual(results[0]["provider_ids"], {"dadata": "dadata:1", "other": "W2"})
        self.assertNotIn("query", results[0])

    def test_dadata_adapter_returns_fias_and_coordinates(self):
        request = SERVER.validate_address_search_payload(valid_payload())
        rows = SERVER.dadata_rows([dadata_suggestion()], request, datetime(2026, 8, 23, tzinfo=timezone.utc))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["fias_id"], "f26b876b-6857-4951-b060-ec6559f04a9a")
        self.assertEqual(rows[0]["coordinate_accuracy"], "building")
        self.assertEqual(rows[0]["house"], "д 7")
        self.assertEqual(rows[0]["latitude"], 60.0191)

    def test_provider_payload_is_sanitized_and_invalid_fias_is_not_trusted(self):
        request = SERVER.validate_address_search_payload(valid_payload())
        suggestion = dadata_suggestion()
        suggestion["data"]["fias_id"] = "not-a-fias-uuid"
        suggestion["data"]["geo_lat"] = "nan"
        suggestion["data"]["region_with_type"] = {"unexpected": "object"}
        rows = SERVER.dadata_rows([suggestion], request, datetime(2026, 8, 23, tzinfo=timezone.utc))
        self.assertEqual(rows[0]["fias_id"], "")
        self.assertIsNone(rows[0]["latitude"])
        self.assertEqual(rows[0]["region"], "")
        self.assertFalse(rows[0]["official_status"])

        nominatim = SERVER.nominatim_rows([{
            "display_name": "Всеволожск",
            "importance": "not-a-number",
            "lat": "60",
            "lon": "30",
        }], request, datetime(2026, 8, 23, tzinfo=timezone.utc))
        self.assertEqual(nominatim[0]["text_score"], 0.68)

    def test_autocomplete_requires_configured_provider(self):
        original_key = SERVER.DADATA_API_KEY
        SERVER.DADATA_API_KEY = ""
        try:
            with self.assertRaises(SERVER.ApiError) as caught:
                SERVER.search_address_providers(valid_payload(interaction="autocomplete"))
        finally:
            SERVER.DADATA_API_KEY = original_key
        self.assertEqual(caught.exception.code, "address_autocomplete_not_configured")

    def test_explicit_search_uses_nominatim_without_persistent_database(self):
        original_key, original_proxy = SERVER.DADATA_API_KEY, SERVER.proxy_geocode
        SERVER.DADATA_API_KEY = ""
        SERVER.proxy_geocode = lambda _payload: [{
            "place_id": 123,
            "osm_type": "way",
            "osm_id": 456,
            "display_name": "Центральная улица, 7, Всеволожск, Ленинградская область",
            "lat": "60.0191",
            "lon": "30.6456",
            "importance": 0.75,
            "type": "house",
            "address": {"state": "Ленинградская область", "town": "Всеволожск", "road": "Центральная улица", "house_number": "7"},
        }]
        try:
            result = SERVER.search_address_providers(valid_payload(interaction="explicit"))
        finally:
            SERVER.DADATA_API_KEY, SERVER.proxy_geocode = original_key, original_proxy
        self.assertEqual(result["provider"]["name"], "nominatim")
        self.assertEqual(result["provider"]["reference"], "openstreetmap")
        self.assertEqual(len(result["results"]), 1)
        self.assertEqual(result["results"][0]["coordinates"]["lat"], 60.0191)

    def test_dadata_request_keeps_key_in_header_and_caches_transiently(self):
        calls = []
        original_key, original_open = SERVER.DADATA_API_KEY, SERVER.urlopen
        SERVER.DADATA_API_KEY = "a" * 40

        def fake_urlopen(request, timeout):
            calls.append((request.full_url, request.headers.get("Authorization"), request.data, timeout))
            return FakeResponse({"suggestions": [dadata_suggestion()]})

        SERVER.urlopen = fake_urlopen
        request = SERVER.validate_address_search_payload(valid_payload())
        try:
            first = SERVER.fetch_dadata_suggestions(request)
            second = SERVER.fetch_dadata_suggestions(request)
        finally:
            SERVER.DADATA_API_KEY, SERVER.urlopen = original_key, original_open
        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address")
        self.assertEqual(calls[0][1], "Token " + "a" * 40)
        self.assertNotIn(("a" * 40).encode(), calls[0][2])

    def test_no_address_database_or_pg_trgm_is_declared(self):
        source = SERVER_PATH.read_text(encoding="utf-8")
        installer = (SERVER_PATH.parent / "install.sh").read_text(encoding="utf-8")
        self.assertNotIn("address_objects_v1", source)
        self.assertNotIn("address_datasets_v1", source)
        self.assertNotIn("pg_trgm", source)
        self.assertNotIn("pg_trgm", installer)
        self.assertIn("search_address_providers", source)
        self.assertIn("ADDRESS_SEARCH_PATH_RE.fullmatch", source)
        self.assertIn("query_sha256", source)
        self.assertIn("JF_DADATA_API_KEY=$DADATA_API_KEY", installer)
        self.assertIsNotNone(SERVER.ADDRESS_SEARCH_PATH_RE.fullmatch(
            "/v1/workspaces/company_workspace_12345/warehouses/warehouse-1/address-search/live"
        ))


if __name__ == "__main__":
    unittest.main()
