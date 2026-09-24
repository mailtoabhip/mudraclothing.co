#!/usr/bin/env python3
"""Apply Drop 01 pricing to data/products.json and write the matching Shopify bulk update.

    python3 scripts/pricing.py preorder   # pre-order window: price = pre-order price
    python3 scripts/pricing.py regular    # after pre-orders close: price = regular price
    python3 scripts/build_pages.py && python3 scripts/fingerprint.py

Source of truth: data/pricing.json (MRP, tiers, which tee is in which tier).
Writes into every product: tier, mrp, price (what Shopify charges now),
regularPrice, preorderEnds (= data/drop.json closes).

Also writes ops/shopify-prices-<phase>.json: the exact Admin API inputs to make
Shopify match (price, compare-at = MRP, metafield custom.regular_price), keyed by
product handle. Variant IDs are resolved from Shopify when it's applied; this repo
never holds Admin credentials. Nothing here changes Shopify by itself.
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main(phase):
    if phase not in ("preorder", "regular"):
        sys.exit("usage: pricing.py preorder|regular")
    cfg = json.loads((ROOT / "data/pricing.json").read_text(encoding="utf-8"))
    drop = json.loads((ROOT / "data/drop.json").read_text(encoding="utf-8"))
    pf = ROOT / "data/products.json"
    data = json.loads(pf.read_text(encoding="utf-8"))
    ops = {"phase": phase, "mrp": cfg["mrp"], "products": {}}
    for p in data["products"]:
        tier = cfg["assign"].get(p["id"])
        if not tier:
            sys.exit(f"no tier for {p['id']} in data/pricing.json")
        t = cfg["tiers"][tier]
        new = {}
        for k, v in p.items():          # keep key order stable, slot pricing after name/no
            if k in ("tier", "mrp", "price", "regularPrice", "preorderEnds"):
                continue
            new[k] = v
            if k == "print":
                new.update(tier=tier, mrp=cfg["mrp"], price=t[phase],
                           regularPrice=t["regular"], preorderEnds=drop["closes"])
        p.clear(); p.update(new)
        ops["products"][p["id"]] = {"price": f"{t[phase]:.2f}", "compareAtPrice": f"{cfg['mrp']:.2f}",
                                    "regularPrice": f"{t['regular']:.2f}"}
    pf.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (ROOT / "ops").mkdir(exist_ok=True)
    out = ROOT / f"ops/shopify-prices-{phase}.json"
    if out.exists():                   # keep Shopify IDs and notes from the last run
        old = json.loads(out.read_text(encoding="utf-8"))
        for k in ("_how", "_snapshot"):
            if k in old: ops[k] = old[k]
        for h, entry in ops["products"].items():
            for k in ("productId", "variantIds"):
                if k in old.get("products", {}).get(h, {}):
                    entry[k] = old["products"][h][k]
    out.write_text(json.dumps(ops, indent=2) + "\n", encoding="utf-8")
    print(f"products.json set to {phase} prices; Shopify plan in {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "")
