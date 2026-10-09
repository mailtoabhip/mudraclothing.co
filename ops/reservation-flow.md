# Pre-order deposit flow: agreed scope

Status: implementation specification only. The current live checkout still collects the full tee price.

## Founder-confirmed rules

- Collect INR 199 per tee as a deposit through 1 December 2026, 23:59 IST. Read the exact cutoff from data/drop.json; do not maintain a second closing date.
- The lower total price applies only to the exact shirts and quantities reserved with a successfully paid deposit. Additional purchases use the price applicable when they are bought.
- Save the price applicable when the reservation is created and its per-unit deposit. A later catalogue price change must not change the reservation total or balance.
- A browser bag, an email supplied by a visitor, or a checkout redirect alone is not proof of a paid reservation or customer identity.

## Proposed customer experience

- Product and bag show the full tee price, deposit due now, and balance separately before payment.
- A successful, verified deposit payment creates the reservation. Failed or abandoned payments do not unlock a price.
- After the cutoff, public catalogue prices use the regular tiers in data/pricing.json: entry INR 1299, core INR 1399, hero INR 1499.
- A signed-in customer sees their own reservations, sizes, quantities, locked total, deposit paid, remaining balance, and a balance payment link.
- Show locked pricing as reservation information alongside public pricing, not as an unlimited customer discount.
- A reservation cannot be used to buy extra quantities at the old price, claimed by another customer, or charged a second balance after payment.
- Proposed balance deadline: before dispatch, with a clearly disclosed payment request. The exact due date and treatment of unpaid balances still need a business decision.
- Proposed refund rule: the deposit is refundable before dispatch, matching the current cancellation promise. Refund and cancellation changes must update the reservation and disable its balance payment link.

## Required implementation

1. Server-controlled reservation/payment records with verified payment events, replay protection and idempotent processing.
2. Authenticated customer access on the Mudra website, tied to the Shopify customer identity. The existing hosted account link does not provide this identity to the static website.
3. A supported Shopify/Razorpay deposit checkout and separately tracked balance checkout. Do not change the actual shirt variant price to INR 199 or represent a deposit as a fully paid shirt order.
4. Explicit links between deposit payment, reservation and balance payment; correct order/invoice accounting and fulfilment only after the required balance has been paid.
5. Backend-enforced deadline and price rules. Frontend prices, browser storage and customer-submitted totals must not be trusted.
6. Coordinated public Shopify and website regular-price updates at the cutoff. Existing closed-phase purchasing behaviour must be reviewed separately before enabling any new orders after the cutoff.

## Current gaps

- The repository is a static storefront without reservation APIs, a reservation datastore or customer authentication callbacks.
- No Shopify Admin connector is callable in the current session. Backend access must be connected through an authorised integration; never request or expose an Admin token in chat.
- Shopify native deferred-payment pre-orders require Shopify Payments or PayPal Express; the existing Razorpay integration cannot be assumed to support them.
- No deposit functionality has been deployed or enabled by this document.

## Acceptance checks

- INR 199 per shirt, including mixed-size and mixed-product bags; total and balance remain explicit.
- Verified payment creates exactly one reservation despite duplicate webhook deliveries.
- Payment failure, forged callbacks, mismatched amounts and unpaid checkout sessions grant no entitlement.
- Anonymous and other-customer requests cannot read or use a reservation.
- Reservations survive browser/device changes after verified sign-in.
- The cutoff uses IST and rejects new deposit purchases after the deadline.
- Catalogue repricing does not affect reserved balances; extra quantities use current pricing.
- Cancellation, partial refund, paid balance and repeated balance requests cannot result in double collection or double fulfilment.

## Official references

- https://help.shopify.com/en/manual/products/purchase-options/pre-orders
- https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started
- https://help.shopify.com/en/manual/fulfillment/managing-orders/create-orders/create-draft
