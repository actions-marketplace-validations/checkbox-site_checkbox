"""Register a site, print the snippet to install, and subscribe a webhook endpoint (run once).

    CHECKBOX_API_KEY=ck_test_… python register_site.py https://yoursite.com https://yoursite.com/webhooks/checkbox

(Or let your coding agent run `checkbox init`, which does all of this and more with one browser approval.)
"""
import sys
from typing import Any, Dict, Optional

from checkbox import Checkbox


def register_site(cb: Checkbox, site_url: str, webhook_url: Optional[str] = None) -> Dict[str, Any]:
    # Idempotency key per URL: re-running returns the same site instead of creating a second one.
    site = cb.sites.create(url=site_url, platform="stripe", request_options={"idempotency_key": f"register-site:{site_url}"})
    endpoint = (
        cb.webhook_endpoints.create(
            url=webhook_url,
            enabled_events=["finding.created", "plan.updated", "site.compliant", "test_run.completed", "test_run.failed"],
        )
        if webhook_url
        else None
    )
    plan = cb.plans.retrieve(site["id"])
    return {"site": site, "endpoint": endpoint, "plan": plan}


def main(argv) -> None:
    if not argv:
        raise SystemExit("usage: register_site.py <site url> [webhook url]")
    cb = Checkbox()
    out = register_site(cb, argv[0], argv[1] if len(argv) > 1 else None)
    print(f"Site {out['site']['id']} ({cb.mode} mode)")
    print(f"1. Add to your <head>: {out['site']['install']['script_tag']}")
    if out["endpoint"]:
        print(f"2. Store CHECKBOX_WEBHOOK_SECRET={out['endpoint']['secret']}")
    nxt = out["plan"]["next_action"]
    print(f"Next: {nxt['description']}" + (f" ({nxt['command']})" if nxt.get("command") else ""))


if __name__ == "__main__":
    main(sys.argv[1:])
