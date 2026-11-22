import json
import os
from io import StringIO
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from django.test import SimpleTestCase, override_settings
from dotenv import load_dotenv

from .client import BASE, MBTAClient, MBTAUnavailable, cache


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
                          "transit": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "transit-tests"}})
class MBTAClientTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.env_patch = patch.dict("os.environ", {"MBTA_API_KEY": "unit-test-key"})
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def response(self, document, url=BASE + "/routes"):
        response = Mock()
        response.geturl.return_value = url
        response.read.return_value = json.dumps(document).encode()
        response.headers = {}
        context = Mock()
        context.__enter__ = Mock(return_value=response)
        context.__exit__ = Mock(return_value=False)
        return context

    @patch("transit.client.urlopen")
    def test_response_cached_and_key_only_in_header(self, open_url):
        open_url.return_value = self.response({"data": []})
        client = MBTAClient()
        self.assertEqual(client.get("routes"), client.get("routes"))
        open_url.assert_called_once()
        request = open_url.call_args.args[0]
        self.assertNotIn("unit-test-key", request.full_url)
        self.assertEqual(request.get_header("X-api-key"), "unit-test-key")

    def test_exported_key_takes_precedence_over_dotenv(self):
        # Standard deployment precedence is intentional. Local run_local.sh
        # removes a stale export before Django loads backend/.env.
        load_dotenv(stream=StringIO("MBTA_API_KEY=valid-file-key\n"))
        self.assertEqual(MBTAClient().api_key, "unit-test-key")
        del os.environ["MBTA_API_KEY"]
        load_dotenv(stream=StringIO("MBTA_API_KEY=valid-file-key\n"))
        self.assertEqual(MBTAClient().api_key, "valid-file-key")

    @patch("transit.client.urlopen")
    def test_authorization_failure_is_not_cached_and_logs_no_key(self, open_url):
        open_url.side_effect = HTTPError(BASE, 403, "private detail", {}, None)
        with self.assertLogs("transit.client", level="WARNING") as logs:
            with self.assertRaises(MBTAUnavailable):
                MBTAClient().get("routes")
        self.assertIn("endpoint=/routes status=403", logs.output[0])
        self.assertNotIn("unit-test-key", logs.output[0])
        self.assertNotIn("private detail", logs.output[0])
        os.environ["MBTA_API_KEY"] = "valid-file-key"
        open_url.side_effect = None
        open_url.return_value = self.response({"data": []})
        self.assertEqual(MBTAClient().get("routes"), {"data": [], "included": []})
        self.assertEqual(open_url.call_args.args[0].get_header("X-api-key"), "valid-file-key")

    @patch("transit.client.urlopen")
    def test_http_failures_are_safe_and_rate_limit_stops_retrying(self, open_url):
        open_url.side_effect = HTTPError(BASE, 429, "Too many requests", {}, None)
        client = MBTAClient()
        for _ in range(2):
            with self.assertRaises(MBTAUnavailable) as error:
                client.get("routes")
            self.assertEqual(error.exception.code, "mbta_rate_limited")
        open_url.assert_called_once()

    @patch("transit.client.urlopen")
    def test_auth_and_network_failures(self, open_url):
        for exception, code in ((HTTPError(BASE, 403, "private detail", {}, None), "mbta_authorization_failed"),
                                (URLError("offline"), "mbta_unavailable"), (TimeoutError(), "mbta_unavailable")):
            open_url.side_effect = exception
            with self.assertRaises(MBTAUnavailable) as error:
                MBTAClient().get("routes")
            self.assertEqual(error.exception.code, code)
            self.assertNotIn("unit-test-key", str(error.exception))

    @patch("transit.client.urlopen")
    def test_pagination_rejects_external_hosts(self, open_url):
        open_url.return_value = self.response({"data": [], "links": {"next": "https://evil.example/routes"}})
        with self.assertRaises(MBTAUnavailable):
            MBTAClient().get("routes")
        open_url.assert_called_once()

    @patch("transit.client.urlopen")
    def test_anonymous_outbound_budget(self, open_url):
        open_url.return_value = self.response({"data": []})
        client = MBTAClient()
        client.api_key = ""
        for _ in range(16):
            client._read(BASE + "/routes")
        with self.assertRaises(MBTAUnavailable):
            client._read(BASE + "/routes")
        self.assertEqual(open_url.call_count, 16)

    def test_cross_host_redirect_is_blocked_before_sending_key(self):
        from .client import _MBTARedirects
        with self.assertRaises(MBTAUnavailable):
            _MBTARedirects().redirect_request(None, None, 302, "", {}, "https://evil.example/")

    @patch("transit.client.urlopen")
    def test_request_budget_prevents_more_network_calls(self, open_url):
        client = MBTAClient()
        client.deadline = 0
        with self.assertRaises(MBTAUnavailable) as error:
            client.get("routes")
        self.assertEqual(error.exception.code, "mbta_timeout")
        open_url.assert_not_called()
