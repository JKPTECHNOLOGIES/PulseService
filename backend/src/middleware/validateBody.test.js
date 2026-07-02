const validateBody = require("./validateBody.middleware");

function mockRes() {
  return {
    statusCode: 200,
    body: null,
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

describe("validateBody", () => {
  it("calls next when all required fields are present", () => {
    const mw = validateBody({ required: ["firstName", "phone"] });
    const req = { body: { firstName: "Ada", phone: "555" } };
    const res = mockRes();
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 listing every missing field", () => {
    const mw = validateBody({ required: ["firstName", "lastName", "phone"] });
    const req = { body: { firstName: "Ada" } };
    const res = mockRes();
    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("lastName");
    expect(res.body.error).toContain("phone");
    expect(res.body.error).not.toContain("firstName");
  });

  it("treats empty and whitespace-only strings as missing", () => {
    const mw = validateBody({ required: ["summary"] });
    const req = { body: { summary: "   " } };
    const res = mockRes();
    mw(req, res, () => undefined);
    expect(res.statusCode).toBe(400);
  });

  it("handles a missing body object", () => {
    const mw = validateBody({ required: ["x"] });
    const res = mockRes();
    mw({}, res, () => undefined);
    expect(res.statusCode).toBe(400);
  });
});
