const {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
} = require("./permissions");

describe("permission defaults", () => {
  it("admin is granted every permission", () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.admin].sort()).toEqual(
      [...ALL_PERMISSIONS].sort(),
    );
  });

  it("technician is limited to job status + field parts/serial issuing", () => {
    // Technicians need to update job status and consume truck stock / install
    // serialized units on their own jobs, but nothing broader (no item CRUD,
    // stock adjustments/transfers, pricing, or other roles' write actions).
    expect(DEFAULT_ROLE_PERMISSIONS.technician).toEqual([
      "jobs.status",
      "inventory.issueToJob",
    ]);
  });

  it("every default permission is a known catalog key", () => {
    const known = new Set(ALL_PERMISSIONS);
    for (const perms of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) {
        expect(known.has(p)).toBe(true);
      }
    }
  });

  it("exec is read-only (no create/edit/delete/manage/void/assign)", () => {
    const writeLike = /\.(create|edit|delete|manage|void|assign|visits)$/;
    const execWrites = DEFAULT_ROLE_PERMISSIONS.exec.filter((p) =>
      writeLike.test(p),
    );
    expect(execWrites).toEqual([]);
  });

  it("catalog keys are unique", () => {
    const keys = PERMISSION_GROUPS.flatMap((g) =>
      g.permissions.map((p) => p.key),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});
