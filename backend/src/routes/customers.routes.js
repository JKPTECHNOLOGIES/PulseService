const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const validateBody = require("../middleware/validateBody.middleware");
const c = require("../controllers/customers.controller");

router.use(auth);

const validateCustomer = validateLookups({ type: "customerType" });

router.get("/", c.list);
router.post(
  "/",
  requirePermission("customers.create"),
  validateBody({ required: ["firstName", "lastName", "phone"] }),
  validateCustomer,
  c.create,
);
router.post(
  "/import",
  requirePermission("customers.create"),
  c.importCustomers,
);
router.get("/:id", c.get);
router.put(
  "/:id",
  requirePermission("customers.edit"),
  validateCustomer,
  c.update,
);
router.delete("/:id", requirePermission("customers.delete"), c["delete"]);

router.get("/:id/locations", c.getLocations);
router.post(
  "/:id/locations",
  requirePermission("customers.edit"),
  c.createLocation,
);

router.get("/:id/contacts", c.getContacts);
router.post(
  "/:id/contacts",
  requirePermission("customers.edit"),
  c.createContact,
);

module.exports = router;
