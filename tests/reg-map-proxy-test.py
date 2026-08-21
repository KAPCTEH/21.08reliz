from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
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

SPEC = importlib.util.spec_from_file_location("justfun_reg_map_server", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(SERVER)


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return self.payload


class MapProxyTests(unittest.TestCase):
    def setUp(self):
        SERVER.MAP_CACHE.clear()
        SERVER.MAP_RATE_BUCKETS.clear()
        SERVER.NOMINATIM_LAST_REQUEST = 0.0

    def test_provider_origin_must_be_https_without_credentials(self):
        for value in ("http://maps.example", "https://user:secret@maps.example", "https://maps.example?q=1"):
            with self.assertRaises(SERVER.ApiError):
                SERVER.validated_provider_origin(value, "тест")

    def test_route_points_are_strictly_validated(self):
        self.assertEqual(SERVER.map_points([{"lat": 59.9, "lon": 30.3}, {"lat": 55.7, "lon": 37.6}])[0], (59.9, 30.3))
        with self.assertRaises(SERVER.ApiError):
            SERVER.map_points([{"lat": 200, "lon": 30}, {"lat": 55, "lon": 37}])

    def test_ten_concurrent_equal_geocode_requests_share_one_upstream_call(self):
        calls = []
        original = SERVER.urlopen

        def fake_urlopen(request, timeout):
            calls.append((request.full_url, timeout, request.headers.get("User-agent", "")))
            return FakeResponse([{"lat": "59.9", "lon": "30.3", "display_name": "Санкт-Петербург"}])

        SERVER.urlopen = fake_urlopen
        try:
            with ThreadPoolExecutor(max_workers=10) as pool:
                results = list(pool.map(lambda _index: SERVER.proxy_geocode({"mode": "search", "query": "Санкт-Петербург", "limit": 5}), range(10)))
        finally:
            SERVER.urlopen = original
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(results), 10)
        self.assertTrue(all(result[0]["display_name"] == "Санкт-Петербург" for result in results))
        self.assertIn("JustFun-Orders-Logistics", calls[0][2])

    def test_route_response_is_cached(self):
        calls = []
        original = SERVER.urlopen

        def fake_urlopen(request, timeout):
            calls.append(request.full_url)
            return FakeResponse({"code": "Ok", "routes": [{"distance": 1000}], "durations": [[0, 1], [1, 0]], "distances": [[0, 1000], [1000, 0]]})

        SERVER.urlopen = fake_urlopen
        payload = {"operation": "route", "points": [{"lat": 59.9, "lon": 30.3}, {"lat": 55.7, "lon": 37.6}]}
        try:
            first = SERVER.proxy_route(payload)
            second = SERVER.proxy_route(payload)
        finally:
            SERVER.urlopen = original
        self.assertEqual(first, second)
        self.assertEqual(len(calls), 1)

    def test_company_rate_limit_is_independent(self):
        original = SERVER.MAP_RATE_PER_MINUTE
        SERVER.MAP_RATE_PER_MINUTE = 2
        try:
            SERVER.enforce_map_rate("company-a")
            SERVER.enforce_map_rate("company-a")
            with self.assertRaises(SERVER.ApiError) as caught:
                SERVER.enforce_map_rate("company-a")
            SERVER.enforce_map_rate("company-b")
        finally:
            SERVER.MAP_RATE_PER_MINUTE = original
        self.assertEqual(caught.exception.code, "map_rate_limited")


if __name__ == "__main__":
    unittest.main()
