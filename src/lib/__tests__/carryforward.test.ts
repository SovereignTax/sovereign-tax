import { describe, it, expect } from "vitest";
import { computeCarryforward } from "../carryforward";

describe("computeCarryforward", () => {
  describe("net gain — no carryforward", () => {
    it("returns zero carryforward when total is positive", () => {
      const r = computeCarryforward(5000, 3000);
      expect(r.netGainLoss).toBe(8000);
      expect(r.deductibleLoss).toBe(0);
      expect(r.carryforwardAmount).toBe(0);
      expect(r.carryforwardST).toBe(0);
      expect(r.carryforwardLT).toBe(0);
    });

    it("prior carryforward absorbed by gains", () => {
      const r = computeCarryforward(5000, 3000, -2000, -1000);
      expect(r.netGainLoss).toBe(5000); // 5000+3000-2000-1000
      expect(r.carryforwardAmount).toBe(0);
    });
  });

  describe("net loss with $3,000 deduction cap", () => {
    it("small loss fully deductible", () => {
      const r = computeCarryforward(-1000, -500);
      expect(r.netGainLoss).toBe(-1500);
      expect(r.deductibleLoss).toBe(-1500);
      expect(r.carryforwardAmount).toBe(0);
      expect(r.carryforwardST).toBe(0);
      expect(r.carryforwardLT).toBe(0);
    });

    it("loss at exactly $3,000 limit", () => {
      const r = computeCarryforward(-2000, -1000);
      expect(r.deductibleLoss).toBe(-3000);
      expect(r.carryforwardAmount).toBe(0);
    });
  });

  describe("IRS Capital Loss Carryover Worksheet — ST loss, LT gain", () => {
    it("ST=-10000 LT=+2000 → ST carryover $5,000", () => {
      const r = computeCarryforward(-10000, 2000);
      expect(r.netGainLoss).toBe(-8000);
      expect(r.deductibleLoss).toBe(-3000);
      expect(r.carryforwardAmount).toBe(-5000);
      expect(r.carryforwardST).toBe(-5000);
      expect(r.carryforwardLT).toBe(0);
    });
  });

  describe("IRS Capital Loss Carryover Worksheet — ST gain, LT loss", () => {
    it("ST=+1000 LT=-12000 → LT carryover $8,000", () => {
      const r = computeCarryforward(1000, -12000);
      expect(r.netGainLoss).toBe(-11000);
      expect(r.deductibleLoss).toBe(-3000);
      expect(r.carryforwardAmount).toBe(-8000);
      expect(r.carryforwardST).toBe(0);
      expect(r.carryforwardLT).toBe(-8000);
    });
  });

  describe("IRS Capital Loss Carryover Worksheet — both losses", () => {
    it("ST=-5000 LT=-7000 → ST $2k + LT $7k carryover", () => {
      const r = computeCarryforward(-5000, -7000);
      expect(r.netGainLoss).toBe(-12000);
      expect(r.deductibleLoss).toBe(-3000);
      expect(r.carryforwardAmount).toBe(-9000);
      // $3k deduction fully consumed by ST ($5k > $3k), none left for LT
      expect(r.carryforwardST).toBe(-2000);
      expect(r.carryforwardLT).toBe(-7000);
    });

    it("ST=-2000 LT=-7000 → ST $0 + LT $6k carryover", () => {
      const r = computeCarryforward(-2000, -7000);
      expect(r.netGainLoss).toBe(-9000);
      expect(r.deductibleLoss).toBe(-3000);
      expect(r.carryforwardAmount).toBe(-6000);
      // $3k deduction: $2k consumed by ST, $1k excess goes to LT
      expect(r.carryforwardST).toBe(0);
      expect(r.carryforwardLT).toBe(-6000);
    });
  });

  describe("prior ST/LT carryforward applied to correct categories", () => {
    it("prior ST carryforward reduces ST subtotal", () => {
      // This year: ST=+1000, LT=0; Prior: ST=-5000
      // Net ST = 1000-5000 = -4000, Net LT = 0
      const r = computeCarryforward(1000, 0, -5000, 0);
      expect(r.shortTermGL).toBe(-4000);
      expect(r.longTermGL).toBe(0);
      expect(r.netGainLoss).toBe(-4000);
      expect(r.deductibleLoss).toBe(-3000);
      expect(r.carryforwardAmount).toBe(-1000);
      expect(r.carryforwardST).toBe(-1000);
      expect(r.carryforwardLT).toBe(0);
    });

    it("prior LT carryforward reduces LT subtotal", () => {
      // This year: ST=0, LT=+2000; Prior: LT=-8000
      // Net ST = 0, Net LT = 2000-8000 = -6000
      const r = computeCarryforward(0, 2000, 0, -8000);
      expect(r.shortTermGL).toBe(0);
      expect(r.longTermGL).toBe(-6000);
      expect(r.netGainLoss).toBe(-6000);
      expect(r.deductibleLoss).toBe(-3000);
      expect(r.carryforwardAmount).toBe(-3000);
      expect(r.carryforwardST).toBe(0);
      expect(r.carryforwardLT).toBe(-3000);
    });

    it("both prior carryforwards applied", () => {
      // This year: ST=+500, LT=+1000; Prior: ST=-3000, LT=-2000
      // Net ST = 500-3000 = -2500, Net LT = 1000-2000 = -1000
      // Total = -3500, deductible = -3000, carryforward = -500
      const r = computeCarryforward(500, 1000, -3000, -2000);
      expect(r.shortTermGL).toBe(-2500);
      expect(r.longTermGL).toBe(-1000);
      expect(r.netGainLoss).toBe(-3500);
      expect(r.deductibleLoss).toBe(-3000);
      expect(r.carryforwardAmount).toBe(-500);
    });
  });

  describe("custom deduction limit", () => {
    it("respects $1,500 MFS limit", () => {
      const r = computeCarryforward(-5000, 0, 0, 0, 1500);
      expect(r.deductibleLoss).toBe(-1500);
      expect(r.carryforwardAmount).toBe(-3500);
    });
  });

  describe("edge cases", () => {
    it("zero inputs", () => {
      const r = computeCarryforward(0, 0, 0, 0);
      expect(r.netGainLoss).toBe(0);
      expect(r.carryforwardAmount).toBe(0);
    });

    it("carryforward split sums to total carryforward", () => {
      // Property: carryforwardST + carryforwardLT == carryforwardAmount
      const cases = [
        [-10000, 2000, 0, 0],
        [1000, -12000, 0, 0],
        [-5000, -7000, 0, 0],
        [-2000, -7000, 0, 0],
        [500, 1000, -3000, -2000],
        [-1000, -500, 0, 0],
      ] as const;

      for (const [st, lt, pst, plt] of cases) {
        const r = computeCarryforward(st, lt, pst, plt);
        expect(r.carryforwardST + r.carryforwardLT).toBe(r.carryforwardAmount);
      }
    });
  });
});
