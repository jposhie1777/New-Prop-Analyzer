import { describe, expect, it } from "vitest";
import { defaultWhatIf, projectUsage } from "@/lib/costs/costModel";

describe("cost model", () => {
  it("keeps a single personal viewer far inside Hobby with $0 extra cost", () => {
    const projection = projectUsage(defaultWhatIf);
    expect(projection.withinHobby).toBe(true);
    expect(projection.extraInfraCostUsd).toBe(0);
    expect(projection.limitShares.functionInvocations).toBeLessThan(0.05);
    expect(projection.bdlCostPerDayUsd).toBeCloseTo(1.31, 2);
    expect(projection.peakBdlPerMinute).toBeLessThan(600);
  });

  it("shares CDN fills between overlapping viewers", () => {
    const solo = projectUsage({ ...defaultWhatIf, viewers: 1 });
    const crowd = projectUsage({ ...defaultWhatIf, viewers: 20, overlapping: true });
    const staggered = projectUsage({ ...defaultWhatIf, viewers: 20, overlapping: false });
    expect(crowd.edgeRequests).toBeCloseTo(solo.edgeRequests * 20, 6);
    expect(crowd.functionInvocations).toBeCloseTo(solo.functionInvocations, 6);
    expect(staggered.functionInvocations).toBeGreaterThan(crowd.functionInvocations);
  });

  it("does nothing when nobody has the page open", () => {
    const idle = projectUsage({ ...defaultWhatIf, viewers: 0 });
    expect(idle.edgeRequests).toBe(0);
    expect(idle.functionInvocations).toBe(0);
    expect(idle.bdlCalls).toBe(0);
  });
});
