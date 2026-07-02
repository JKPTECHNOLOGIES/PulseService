const permissionsService = require("../services/permissions.service");
const { requirePermission } = require("./permission.middleware");

// The middleware reads permissionsService.getForRole at call time, so we can
// swap the property to a stub without touching the database (avoids vi.mock's
// CommonJS hoisting quirks).
const originalGetForRole = permissionsService.getForRole;
afterEach(() => {
  permissionsService.getForRole = originalGetForRole;
});
function stubPermissions(perms) {
  permissionsService.getForRole = () => Promise.resolve(perms);
}

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

async function invoke(mw, req) {
  const res = mockRes();
  let nextCalled = false;
  await mw(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

describe("requirePermission", () => {
  it("calls next when the role holds the permission", async () => {
    stubPermissions(["invoices.void"]);
    const { nextCalled } = await invoke(requirePermission("invoices.void"), {
      user: { role: "manager" },
    });
    expect(nextCalled).toBe(true);
  });

  it("responds 403 when the role lacks the permission", async () => {
    stubPermissions(["jobs.status"]);
    const { res, nextCalled } = await invoke(
      requirePermission("invoices.void"),
      { user: { role: "technician" } },
    );
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("grants access when the role has ANY of the listed permissions", async () => {
    stubPermissions(["reports.operational"]);
    const { nextCalled } = await invoke(
      requirePermission("reports.financial", "reports.operational"),
      { user: { role: "dispatcher" } },
    );
    expect(nextCalled).toBe(true);
  });

  it("responds 401 when unauthenticated", async () => {
    const { res, nextCalled } = await invoke(requirePermission("x"), {});
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
