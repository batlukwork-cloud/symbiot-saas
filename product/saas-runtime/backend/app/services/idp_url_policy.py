from __future__ import annotations

import ipaddress
from urllib.parse import urlparse


RESERVED_HOSTS = {"localhost", "127.0.0.1", "::1"}
RESERVED_SUFFIXES = (".localhost", ".local", ".test", ".invalid", ".example")


def classify_https_production_url(value: str) -> dict[str, object]:
    parsed = urlparse((value or "").strip())
    hostname = (parsed.hostname or "").lower()
    reasons: list[str] = []

    if parsed.scheme != "https":
        reasons.append("scheme_is_not_https")
    if not hostname:
        reasons.append("hostname_missing")
    if hostname in RESERVED_HOSTS or hostname.endswith(RESERVED_SUFFIXES) or hostname.startswith("example."):
        reasons.append("reserved_or_demo_hostname")

    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            reasons.append("non_public_ip")
    except ValueError:
        pass

    return {
        "url_configured": bool(value and value.strip()),
        "scheme": parsed.scheme,
        "hostname": hostname,
        "production_like": not reasons,
        "reasons": reasons,
    }


def is_production_https_url(value: str) -> bool:
    return bool(classify_https_production_url(value)["production_like"])
