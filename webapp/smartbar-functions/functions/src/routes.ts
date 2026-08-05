import express from "express";

import CatCtrl from "./controllers/cat";
import UserCtrl from "./controllers/user";
import BottleCtrl from "./controllers/bottle";
import BottleStatCtrl from "./controllers/bottleStat";
import BusinessCtrl from "./controllers/business";
import DeviceCtrl from "./controllers/device";
import CategoryCtrl from "./controllers/category";
import InventoryCtrl from "./controllers/inventory";
import StripeCtrl from "./controllers/stripe";
import EmailCtrl from "./controllers/email";
import DemoCtrl from "./controllers/demo";
import PlatformCtrl from "./controllers/platform";
import DashboardCtrl from "./controllers/dashboard";
import ShiftCtrl from "./controllers/shift";

import {
  attachIdentity,
  requireAuth,
  requireUser,
  requireRole,
  requireBusinessMember,
} from "./auth";

export default function setRoutes(app) {
  const router = express.Router();

  const catCtrl = new CatCtrl();
  const userCtrl = new UserCtrl();
  const bottleCtrl = new BottleCtrl();
  const bottleStatCtrl = new BottleStatCtrl();
  const businessCtrl = new BusinessCtrl();
  const deviceCtrl = new DeviceCtrl();
  const categoryCtrl = new CategoryCtrl();
  const inventoryCtrl = new InventoryCtrl();
  const stripeCtrl = new StripeCtrl();
  const emailCtrl = new EmailCtrl();
  const demoCtrl = new DemoCtrl();
  const platformCtrl = new PlatformCtrl();
  const dashboardCtrl = new DashboardCtrl();
  const shiftCtrl = new ShiftCtrl();

  // Resolve an identity from the token, if there is one. Never rejects; each
  // route below states its own requirement.
  router.use(attachIdentity);

  // ─── Public routes ─────────────────────────────────────────────────────
  // Everything not listed here requires authentication.
  router.route("/login").post(userCtrl.login);
  router.route("/device/login").post(deviceCtrl.login);
  router.route("/user/password-reset").post(userCtrl.passwordResetRequest);
  router.route("/user/password-reset-verify").post(userCtrl.passwordResetVerify);

  // Everything below this line needs a valid user or device token.
  router.use(requireAuth);

  // ─── Catalog ───────────────────────────────────────────────────────────
  // Reads are open to any authenticated caller (the mobile app and dashboard
  // both need lookups); writes are restricted to staff roles.
  router.route("/bottles").get(bottleCtrl.getAll);
  router.route("/bottles/page").get(bottleCtrl.getPage);
  router.route("/bottles/count").get(bottleCtrl.count);
  router.route("/bottle/:id").get(bottleCtrl.get);
  router.route("/bottles/:businessId").get(requireUser, bottleCtrl.getAllInBusiness);
  router.route("/bottle").post(requireRole('business_admin', 'manager'), bottleCtrl.insert);
  router.route("/bottle/:id").put(requireRole('business_admin', 'manager'), bottleCtrl.update);
  router.route("/bottle/:id").delete(requireRole('admin'), bottleCtrl.delete);

  // Product lookup and upsert. The mobile app writes here after a scan, so a
  // device token is sufficient — but it must be a token.
  router.route("/product/:barcode").get(bottleCtrl.getByBarcode);
  router.route("/product/:barcode").put(bottleCtrl.upsertByBarcode);
  router.route("/product/:barcode/image").post(bottleCtrl.uploadImage);

  // ─── Cats (legacy sample resource) ─────────────────────────────────────
  router.route("/cats").get(catCtrl.getAll);
  router.route("/cats/count").get(catCtrl.count);
  router.route("/cat").post(requireRole('admin'), catCtrl.insert);
  router.route("/cat/:id").get(catCtrl.get);
  router.route("/cat/:id").put(requireRole('admin'), catCtrl.update);
  router.route("/cat/:id").delete(requireRole('admin'), catCtrl.delete);

  // ─── Bottle stats ──────────────────────────────────────────────────────
  // POST is the device scan endpoint; the rest are dashboard reads.
  router.route("/bottle-stats").post(bottleStatCtrl.insert);
  router.route("/bottle-stats").get(requireUser, bottleStatCtrl.getAllInBusiness);
  router.route("/bottle-stats/count").get(requireUser, bottleStatCtrl.count);
  router.route("/bottle-stat/:id").get(requireUser, bottleStatCtrl.get);
  router.route("/bottle-stat/:id").put(requireRole('business_admin', 'manager'), bottleStatCtrl.update);
  router.route("/bottle-stat/:id").delete(requireRole('business_admin', 'manager'), bottleStatCtrl.delete);

  // ─── Businesses ────────────────────────────────────────────────────────
  router.route("/businesses").get(requireRole('admin'), businessCtrl.getAll);
  router.route("/businesses/count").get(requireRole('admin'), businessCtrl.count);
  router.route("/business").post(requireRole('admin'), businessCtrl.insert);
  router.route("/business/:id").get(requireBusinessMember, businessCtrl.get);
  router.route("/business/:id/users").get(requireBusinessMember, businessCtrl.getUsers);
  router.route("/business/:id/devices").get(requireBusinessMember, businessCtrl.getDevices);
  router.route("/business/:id").put(requireBusinessMember, businessCtrl.update);
  router.route("/business/:id").delete(requireRole('admin'), businessCtrl.delete);

  // ─── Users ─────────────────────────────────────────────────────────────
  router.route("/users").get(requireRole('admin'), userCtrl.getAllWith(['business']));
  router.route("/users/count").get(requireRole('admin'), userCtrl.count);
  router.route("/user").post(requireRole('admin'), userCtrl.insert);
  router.route("/user/:id").get(requireUser, userCtrl.get);
  router.route("/user/:id").put(requireUser, userCtrl.update);
  router.route("/user/:id").delete(requireRole('admin'), userCtrl.delete);

  // ─── Devices ───────────────────────────────────────────────────────────
  router.route("/devices").get(requireRole('admin'), deviceCtrl.getAllWith(['business']));
  router.route("/devices/count").get(requireRole('admin'), deviceCtrl.count);
  router.route("/device").post(requireRole('admin'), deviceCtrl.insert);
  router.route("/device/serial/:serialNumber").get(deviceCtrl.getBySerial);
  router.route("/device/serial/:serialNumber/assign").post(requireUser, deviceCtrl.assignBusiness);
  router.route("/device/:id").get(requireUser, deviceCtrl.get);
  router.route("/device/:id").put(requireRole('business_admin', 'manager'), deviceCtrl.update);
  router.route("/device/:id").delete(requireRole('admin'), deviceCtrl.delete);

  // ─── Categories ────────────────────────────────────────────────────────
  router.route("/categories").get(categoryCtrl.getAll);
  router.route("/categories/tree").get(categoryCtrl.getTree);
  router.route("/category").post(categoryCtrl.insert);
  router.route("/category/:id").put(requireRole('business_admin', 'manager'), categoryCtrl.update);
  router.route("/category/:id").delete(requireRole('admin'), categoryCtrl.delete);

  // ─── Inventory sessions ────────────────────────────────────────────────
  router.route("/inventory/sessions").get(requireUser, inventoryCtrl.getSessions);
  router.route("/inventory/session").post(requireUser, inventoryCtrl.startSession);
  router.route("/inventory/session/:id").get(requireUser, inventoryCtrl.getSession);
  router.route("/inventory/session/:id").put(requireUser, inventoryCtrl.updateSession);
  router.route("/inventory/session/:id").delete(requireUser, inventoryCtrl.deleteSession);

  // ─── Inventory readings ────────────────────────────────────────────────
  router.route("/inventory/readings").get(requireUser, inventoryCtrl.getReadings);
  router.route("/inventory/reading").post(inventoryCtrl.addReadingAPI);
  router.route("/inventory/reading/:id").delete(requireUser, inventoryCtrl.deleteReading);

  // ─── Inventory events ──────────────────────────────────────────────────
  router.route("/inventory/events").get(requireUser, inventoryCtrl.getEvents);
  router.route("/inventory/event").post(requireUser, inventoryCtrl.addEvent);
  router.route("/inventory/event/:id").delete(requireUser, inventoryCtrl.deleteEvent);

  // ─── Consumption reports ───────────────────────────────────────────────
  router.route("/inventory/reports").get(requireUser, inventoryCtrl.getReports);
  router.route("/inventory/report").post(requireUser, inventoryCtrl.generateReport);
  router.route("/inventory/report/:id").get(requireUser, inventoryCtrl.getReport);

  // ─── Product inventory config and stock entry ──────────────────────────
  router.route("/inventory/product/:barcode/config").put(requireUser, inventoryCtrl.updateProductConfig);
  router.route("/inventory/opening-count").post(requireUser, inventoryCtrl.recordOpeningCount);
  router.route("/inventory/add-stock").post(requireUser, inventoryCtrl.addStock);
  router.route("/inventory/seed-sample").post(requireUser, inventoryCtrl.seedSampleInventory);

  // ─── Dashboard ─────────────────────────────────────────────────────────
  router.route("/dashboard").get(requireUser, dashboardCtrl.get);

  // ─── Shifts ────────────────────────────────────────────────────────────
  router.route("/shifts").get(requireUser, shiftCtrl.getAll);
  router.route("/shifts/defaults").post(requireUser, shiftCtrl.seedDefaults);
  router.route("/shift").post(requireUser, shiftCtrl.insert);
  router.route("/shift/:id").put(requireUser, shiftCtrl.update);
  router.route("/shift/:id").delete(requireUser, shiftCtrl.delete);

  // ─── Demo environment (platform admins only) ───────────────────────────
  router.route("/demo/seed").post(requireRole('admin'), demoCtrl.seed);
  router.route("/demo/reset").post(requireRole('admin'), demoCtrl.reset);
  router.route("/demo/simulate").post(requireRole('admin'), demoCtrl.simulate);
  router.route("/demo/dashboard").get(requireRole('admin'), demoCtrl.dashboard);

  // ─── Platform administration ───────────────────────────────────────────
  router.route("/platform/businesses").get(requireRole('admin'), platformCtrl.listBusinesses);
  router.route("/platform/businesses").post(requireRole('admin'), platformCtrl.onboardBusiness);
  router.route("/platform/businesses/:id/status").patch(requireRole('admin'), platformCtrl.updateBusinessStatus);
  router.route("/platform/devices/:id/assign").patch(requireRole('admin'), platformCtrl.assignDevice);
  router.route("/platform/devices/:id/demo").patch(requireRole('admin'), platformCtrl.setDeviceDemo);

  // ─── Stripe / email ────────────────────────────────────────────────────
  router.route("/stripe/test").post(requireRole('admin'), stripeCtrl.test);
  router.route("/stripe/customer/:customerId").get(requireRole('admin'), stripeCtrl.retrieveCustomer);
  router.route("/messages/test").get(requireRole('admin'), emailCtrl.sendMessage);

  app.use("/api", router);
}
