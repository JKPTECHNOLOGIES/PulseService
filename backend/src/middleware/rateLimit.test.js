const rateLimit = require("./rateLimit.middleware");

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function run(mw, ip) {
  const res = mockRes();
  let nextCalled = false;
  mw({ ip }, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

describe("rateLimit", () => {
  it("allows up to max requests then blocks with 429", () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2 });
    expect(run(mw, "1.1.1.1").nextCalled).toBe(true);
    expect(run(mw, "1.1.1.1").nextCalled).toBe(true);
    const third = run(mw, "1.1.1.1");
    expect(third.nextCalled).toBe(false);
    expect(third.res.statusCode).toBe(429);
    expect(third.res.headers["Retry-After"]).toBeDefined();
  });

  it("tracks limits per client IP independently", () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });
    expect(run(mw, "1.1.1.1").nextCalled).toBe(true);
    expect(run(mw, "1.1.1.1").nextCalled).toBe(false);
    // A different IP has its own bucket.
    expect(run(mw, "2.2.2.2").nextCalled).toBe(true);
  });

  it("resets after the window elapses", () => {
    vi.useFakeTimers();
    const mw = rateLimit({ windowMs: 1000, max: 1 });
    expect(run(mw, "9.9.9.9").nextCalled).toBe(true);
    expect(run(mw, "9.9.9.9").nextCalled).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(run(mw, "9.9.9.9").nextCalled).toBe(true);
    vi.useRealTimers();
  });
});
