# Pre-order deposit flow: agreed scope

Status: the storefront routes pre-orders to signed-in INR 199-per-tee deposit invoices. Product pages, home cards and bag identify the deposit separately from the full tee price. The real paid-deposit webhook and balance-invoice checks remain outstanding until the founder pays a deposit.

`data/reservations.json` holds the deposit amount and rollout flag. It is enabled at the founder's request. The dedicated `/reservations` page shows only the signed-in customer's records. Balance payments are blocked on the server before the configured launch date.

## Founder-confirmed rules

- Collect INR 199 per tee until orders open on 1 November 2026, midnight IST. Read the exact cutoff and launch from data/drop.json; do not maintain a second closing date.
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

## Remaining verification

- Complete the founder's real payment, verify the signed webhook and customer-owned reservation, then verify the balance invoice without automatically paying it.
- Check the enabled storefront experience at desktop and phone widths before switching the rollout flag.
- The approved Mudra Reservations app now has `write_products` in addition to its customer, order and draft-order permissions. Automatic maintenance changes only the seven live catalogue products, after the configured cutoff; saved reservation prices do not change.
- The daily Vercel cron is not an exact-deadline guarantee. A scheduler delay can leave an already-issued Shopify deposit invoice payable briefly after the cutoff. Late payments grant no locked-price entitlement and need review and refund. Verify scheduling precision before promising immediate invoice expiry.
- Static SEO prices and the merchant feed still require a cutoff rebuild. The browser uses regular prices after the cutoff, and maintenance updates Shopify prices.
- Shopify native deferred-payment pre-orders require Shopify Payments or PayPal Express; the existing Razorpay integration cannot be assumed to support them.
- Keep app credentials and the session/cron keys in Vercel environment variables only. Never request or expose an Admin token in chat.

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
