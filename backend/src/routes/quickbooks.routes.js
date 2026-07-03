const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const soap = require("../controllers/quickbooksSoap.controller");
const c = require("../controllers/quickbooks.controller");

// Public QBWC SOAP endpoint — QuickBooks Web Connector can't send a JWT, it
// authenticates via the SOAP `authenticate` method instead. Needs the raw XML
// body (QBWC posts text/xml), not our global JSON parser.
router.post("/soap", express.text({ type: () => true }), soap.handle);

// Everything else is an authenticated admin/finance surface.
router.use(auth);

router.get("/settings", requirePermission("quickbooks.manage"), c.getSettings);
router.put("/settings", requirePermission("quickbooks.manage"), c.updateSettings);
router.get(
  "/connector-file",
  requirePermission("quickbooks.manage"),
  c.downloadConnectorFile,
);

router.get("/queue", requirePermission("quickbooks.manage"), c.listQueue);
router.post(
  "/queue/:id/retry",
  requirePermission("quickbooks.manage"),
  c.retryQueueItem,
);
router.get("/mappings", requirePermission("quickbooks.manage"), c.listMappings);
router.post(
  "/resync/customers",
  requirePermission("quickbooks.manage"),
  c.resyncCustomers,
);

router.get(
  "/item-mappings",
  requirePermission("quickbooks.manage"),
  c.listItemMappings,
);
router.post(
  "/item-mappings",
  requirePermission("quickbooks.manage"),
  validateLookups({ lineItemType: "lineItemType" }),
  c.saveItemMapping,
);
router.delete(
  "/item-mappings/:id",
  requirePermission("quickbooks.manage"),
  c.deleteItemMapping,
);

module.exports = router;
