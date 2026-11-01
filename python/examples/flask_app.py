"""Flask: a Checkout route preflighted by Checkbox, and the Checkbox webhook receiver.

    pip install checkbox-sdk stripe flask      (Python SDK publish name to be decided; import name is `checkbox`)
    CHECKBOX_API_KEY=ck_test_… CHECKBOX_WEBHOOK_SECRET=whsec_… STRIPE_SECRET_KEY=sk_test_… STRIPE_PRICE_ID=price_… flask --app flask_app run
"""
import os

from checkbox import Checkbox, SignatureVerificationError
from compliant_checkout import compliant_checkout_params_or_original

cb = Checkbox()  # reads CHECKBOX_API_KEY

MERCHANT = {
    "merchant_name": "Acme",
    "price": 19.99,
    "currency": "usd",
    "interval": "month",
    "cancel_url": "https://acme.example/account/cancel",
}


def handle_event(event):
    """What your app does with each Checkbox event (replace with your own handling)."""
    if event["type"] == "finding.created":
        return f"New compliance finding: {event['data']['object'].get('check_id')}"
    if event["type"] == "plan.updated":
        return f"Compliance plan is now {event['data']['object'].get('status')}"
    if event["type"] == "site.compliant":
        return "Site is compliant"
    return f"Ignored {event['type']}"


def receive_webhook(raw_body: bytes, signature: str, secret: str):
    """Verifies Checkbox-Signature over the RAW body and handles the event. Returns (status, body)."""
    try:
        event = Checkbox.webhooks.construct_event(raw_body, signature, secret)
    except SignatureVerificationError as err:
        return 400, {"error": err.message}
    return 200, {"received": True, "handled": handle_event(event)}


def create_app():
    import stripe
    from flask import Flask, jsonify, request

    stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
    app = Flask(__name__)

    @app.post("/checkout")
    def checkout():
        params = {
            "mode": "subscription",
            "line_items": [{"price": os.environ["STRIPE_PRICE_ID"], "quantity": 1}],
            "success_url": request.host_url + "welcome?session_id={CHECKOUT_SESSION_ID}",
            "cancel_url": request.host_url + "pricing",
        }
        params, check, corrected = compliant_checkout_params_or_original(cb, params, MERCHANT)
        if corrected:
            app.logger.info("Checkbox corrected the Checkout params (check %s)", check["id"])
        session = stripe.checkout.Session.create(**params)
        return jsonify(url=session.url)

    @app.post("/webhooks/checkbox")
    def checkbox_webhook():
        status, body = receive_webhook(request.get_data(), request.headers.get("Checkbox-Signature", ""), os.environ["CHECKBOX_WEBHOOK_SECRET"])
        return jsonify(body), status

    return app


if __name__ == "__main__":
    create_app().run(port=int(os.environ.get("PORT", "3000")))
