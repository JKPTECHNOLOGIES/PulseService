const { computeEffectivePrice } = require("./pricing.service");

describe("pricing.service", () => {
  describe("computeEffectivePrice", () => {
    it("returns the catalog price unchanged when no tier is assigned", () => {
      expect(computeEffectivePrice(100, null, null)).toBe(100);
    });

    it("applies a percentage tier discount", () => {
      const tier = { discountType: "percentage", discountValue: 10 };
      expect(computeEffectivePrice(100, tier, null)).toBe(90);
    });

    it("applies a fixed-amount tier discount", () => {
      const tier = { discountType: "fixed", discountValue: 15 };
      expect(computeEffectivePrice(100, tier, null)).toBe(85);
    });

    it("never goes negative on a fixed discount larger than the price", () => {
      const tier = { discountType: "fixed", discountValue: 500 };
      expect(computeEffectivePrice(100, tier, null)).toBe(0);
    });

    it("prefers a per-item override over the tier's blanket discount", () => {
      const tier = { discountType: "percentage", discountValue: 10 };
      const override = { overrideType: "fixed_price", overrideValue: 45 };
      expect(computeEffectivePrice(100, tier, override)).toBe(45);
    });

    it("applies a percentage override", () => {
      const override = { overrideType: "percentage", overrideValue: 25 };
      expect(computeEffectivePrice(200, null, override)).toBe(150);
    });

    it("applies a fixed-amount override", () => {
      const override = { overrideType: "fixed", overrideValue: 20 };
      expect(computeEffectivePrice(100, null, override)).toBe(80);
    });

    it("rounds to the nearest cent", () => {
      const tier = { discountType: "percentage", discountValue: 33.33 };
      expect(computeEffectivePrice(10, tier, null)).toBe(6.67);
    });
  });
});
