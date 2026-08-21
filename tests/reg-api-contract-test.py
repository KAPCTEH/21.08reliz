from __future__ import annotations

from email.message import Message
import importlib.util
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

SPEC = importlib.util.spec_from_file_location("justfun_reg_contract_server", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(SERVER)


def handler_with_headers(**headers):
    handler = object.__new__(SERVER.Handler)
    message = Message()
    for name, value in headers.items():
        message[name.replace("_", "-")] = str(value)
    handler.headers = message
    return handler


class ApiContractTests(unittest.TestCase):
    def test_current_contract_is_accepted(self):
        handler_with_headers(
            X_JustFun_API_Contract=SERVER.API_CONTRACT,
            X_JustFun_Client_Version=SERVER.VERSION,
        ).require_compatible_client()

    def test_incompatible_contract_is_rejected_with_upgrade_status(self):
        with self.assertRaises(SERVER.ApiError) as caught:
            handler_with_headers(
                X_JustFun_API_Contract=SERVER.API_CONTRACT + 1,
                X_JustFun_Client_Version="99.0.0",
            ).require_compatible_client()
        self.assertEqual(caught.exception.status, 426)
        self.assertEqual(caught.exception.code, "client_upgrade_required")
        self.assertEqual(caught.exception.details["api_contract"], SERVER.API_CONTRACT)

    def test_missing_contract_is_only_allowed_during_transition(self):
        original = SERVER.REQUIRE_API_CONTRACT
        try:
            SERVER.REQUIRE_API_CONTRACT = False
            handler_with_headers().require_compatible_client()
            SERVER.REQUIRE_API_CONTRACT = True
            with self.assertRaises(SERVER.ApiError) as caught:
                handler_with_headers().require_compatible_client()
        finally:
            SERVER.REQUIRE_API_CONTRACT = original
        self.assertEqual(caught.exception.status, 426)

    def test_invalid_contract_is_not_silently_ignored(self):
        with self.assertRaises(SERVER.ApiError) as caught:
            handler_with_headers(X_JustFun_API_Contract="broken").require_compatible_client()
        self.assertEqual(caught.exception.status, 400)
        self.assertEqual(caught.exception.code, "invalid_api_contract")


if __name__ == "__main__":
    unittest.main()
