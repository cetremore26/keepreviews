import { describe, expect, it } from "vitest";
import { normalizeProductId, toProductGid } from "../app/utils/product-id.server";

describe("normalizeProductId", () => {
  it.each([
    ["9392803971322", "9392803971322"],
    ["gid://shopify/Product/9392803971322", "9392803971322"],
    ["  9392803971322 ", "9392803971322"],
    ["  gid://shopify/Product/9392803971322\n", "9392803971322"],
    ["0123", "123"],
    ["gid://shopify/Product/0123", "123"],
    ["0", "0"],
  ])("%j -> %j", (raw, expected) => {
    expect(normalizeProductId(raw)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "abc",
    "12abc",
    "-5",
    "1.5",
    "gid://shopify/Order/9392803971322",
    "gid://shopify/ProductVariant/9392803971322",
    "gid://shopify/Product/",
    "gid://shopify/Product/abc",
    "gid://shopify/Product/123/extra",
    "gid://shopify/Product/123' OR 1=1",
    "1".repeat(21),
  ])("rejects %j", (raw) => {
    expect(normalizeProductId(raw)).toBeNull();
  });

  it("rejects null and undefined", () => {
    expect(normalizeProductId(null)).toBeNull();
    expect(normalizeProductId(undefined)).toBeNull();
  });

  it("is idempotent, and round-trips through toProductGid", () => {
    const once = normalizeProductId("gid://shopify/Product/9392803971322")!;
    expect(normalizeProductId(once)).toBe(once);
    expect(normalizeProductId(toProductGid(once))).toBe(once);
  });
});
