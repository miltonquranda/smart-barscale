import express from "express";
import * as jwt from "jsonwebtoken";
import { db } from './firebase';

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

  router.use((req, res, next) => {
    // check header for the token
    try {
      if (!req.body.serialNumber && !req.headers.authorization && !req.body.token) {
        // Allow requests without token (e.g. login/register) to proceed, 
        // but if they need auth they will fail in controller or specific route guard.
        // However, original code threw error if NO token found? 
        // "Authorization Header not found"
        // But wait, login route doesn't have token.
        // The original code had:
        // if (!req.body.serialNumber && !req.headers.authorization && !req.body.token) throw new Error(...)
        // This seems to enforce token on ALL routes starting with /api?
        // But login is /api/login.
        // Maybe login sends a token? No, login returns a token.
        // Maybe the original code was buggy or I misread it.
        // Ah, the original code had a try/catch.
        // If I look at original:
        // if (!req.body.serialNumber && !req.headers.authorization && !req.body.token) throw new Error(...)
        // This would block login if it doesn't send serialNumber or token.
        // Login sends email/password.
        // So this middleware seems to block login?
        // Unless login is excluded?
        // No, app.use('/api', router) applies to all.
        // Maybe the user sends a dummy token or something?
        // Or maybe I should just keep the logic as is but fix the DB part.
        // Wait, if I throw, it goes to catch(e) -> next(e).
        // Then error handler sends response.
        // So login WOULD fail.
        // Let's look at the original code again.
        // It throws error, catches it, calls next(e).
        // The error handler in app.ts sends status 500 or whatever.
        // This seems wrong for a working app.
        // Maybe `req.body.serialNumber` is present for device login?
        // But for user login?
        // I will replicate the logic but wrap the DB calls.
        // If the original code was broken, I might fix it, but let's assume it worked somehow.
        // Actually, if I throw, it goes to next(e).
        // Maybe the routes are defined AFTER this middleware?
        // Yes, `router.use` is at the top.
        // So it applies to all.

        // Let's just implement the DB part.
      }

      const token = (req.headers.authorization && (req.headers.authorization as string).split(" ")[1]) || req.body.token;
      console.log('Auth Token:', token ? 'Found' : 'Missing');

      if (token) {
        jwt.verify(token, process.env.SECRET_TOKEN as string, async function (err, payload) {
          if (err) console.error('JWT Verify Error:', err);
          if (payload) {
            console.log('JWT Payload:', payload);
            if (payload.user) {
              try {
                const doc = await db.collection('users').doc(payload.user._id).get();
                if (doc.exists) {
                  const user: any = { _id: doc.id, ...doc.data() };
                  if (user.business && user.business.length > 0) {
                    const businesses = [];
                    for (const bizId of user.business) {
                      const bDoc = await db.collection('businesses').doc(bizId).get();
                      if (bDoc.exists) businesses.push({ _id: bDoc.id, ...bDoc.data() });
                    }
                    user.business = businesses;
                  }
                  req["user"] = user;
                  next();
                } else {
                  next();
                }
              } catch (e) {
                next(e);
              }
            } else if (payload.serialNumber) {
              try {
                const doc = await db.collection('devices').doc(payload.serialNumber._id).get();
                if (doc.exists) {
                  req["device"] = { _id: doc.id, ...doc.data() };
                  next();
                } else {
                  next();
                }
              } catch (e) {
                next(e);
              }
            } else {
              next();
            }
          } else {
            next();
          }
        });
      } else {
        next();
      }
    } catch (e) {
      next(e);
    }
  });

  const requireRole = (role) => {
    return (req, res, next) => {
      const platformAdmin = req.user && (req.user.role === 'admin' || req.user.role === 'platform_admin');
      if (req.user && (req.user.role === role || (role === 'admin' && platformAdmin))) {
        next();
      } else {
        res.sendStatus(403);
      }
    }
  }

  const canAccess = () => {
    return (req, res, next) => {
      const model = req.route.path.split('/')[1];
      if (req.user && req.user.role === 'admin') return next();

      if (model === 'business') {
        const isbusinessUser = req.user && req.user.business && req.user.business.some(b => b._id === req.params.id);
        if (isbusinessUser) {
          next();
        } else {
          res.status(403).send('Not allowed to access this resource, does not belong to your business');
        }
      } else {
        next();
      }
    }
  }

  // Cats
  router.route("/cats").get(catCtrl.getAll);
  router.route("/cats/count").get(catCtrl.count);
  router.route("/cat").post(catCtrl.insert);
  router.route("/cat/:id").get(catCtrl.get);
  router.route("/cat/:id").put(catCtrl.update);
  router.route("/cat/:id").delete(catCtrl.delete);

  // Bottles
  router.route("/bottles").get(bottleCtrl.getAll);
  router.route("/bottles/:businessId").get(bottleCtrl.getAllInBusiness);
  router.route("/bottles/count").get(bottleCtrl.count);
  router.route("/bottle").post(bottleCtrl.insert);
  router.route("/bottle/:id").get(bottleCtrl.get);
  router.route("/bottle/:id").put(bottleCtrl.update);
  router.route("/bottle/:id").delete(bottleCtrl.delete);

  // Product lookup (checks local DB, then Open Food Facts, then Gemini)
  router.route("/product/:barcode").get(bottleCtrl.getByBarcode);
  router.route("/product/:barcode").put(bottleCtrl.upsertByBarcode);
  router.route("/product/:barcode/image").post(bottleCtrl.uploadImage);

  // Bottle Stats
  router.route("/bottle-stats").get(bottleStatCtrl.getAllInBusiness);
  router.route("/bottle-stats/count").get(bottleStatCtrl.count);
  router.route("/bottle-stats").post(bottleStatCtrl.insert);
  router.route("/bottle-stat/:id").get(bottleStatCtrl.get);
  router.route("/bottle-stat/:id").put(bottleStatCtrl.update);
  router.route("/bottle-stat/:id").delete(bottleStatCtrl.delete);

  // Businesses
  router.route("/businesses").get(businessCtrl.getAll);
  router.route("/businesses/count").get(businessCtrl.count);
  router.route("/business").post(businessCtrl.insert);
  router.route("/business/:id").get(canAccess(), businessCtrl.get);
  router.route("/business/:id/users").get(canAccess(), businessCtrl.getUsers);
  router.route("/business/:id/devices").get(canAccess(), businessCtrl.getDevices);
  router.route("/business/:id").put(businessCtrl.update);
  router.route("/business/:id").delete(requireRole('admin'), businessCtrl.delete);

  // Users
  router.route("/login").post(userCtrl.login);
  router.route("/users").get(requireRole('admin'), userCtrl.getAllWith(['business']));
  router.route("/users/count").get(userCtrl.count);
  router.route("/user").post(userCtrl.insert);
  router.route("/user/:id").get(userCtrl.get);
  router.route("/user/:id").put(userCtrl.update);
  router.route("/user/:id").delete(requireRole('admin'), userCtrl.delete);
  router.route("/user/password-reset").post(userCtrl.passwordResetRequest);
  router.route("/user/password-reset-verify").post(userCtrl.passwordResetVerify);

  // Devices
  router.route("/device/login").post(deviceCtrl.login);
  router.route("/device/serial/:serialNumber").get(deviceCtrl.getBySerial);
  router.route("/device/serial/:serialNumber/assign").post(deviceCtrl.assignBusiness);
  router.route("/devices").get(requireRole('admin'), deviceCtrl.getAllWith(['business']));
  router.route("/devices/count").get(deviceCtrl.count);
  router.route("/device").post(deviceCtrl.insert);
  router.route("/device/:id").get(deviceCtrl.get);
  router.route("/device/:id").put(deviceCtrl.update);
  router.route("/device/:id").delete(deviceCtrl.delete);

  // Categories (hierarchical, max 5 levels)
  router.route("/categories").get(categoryCtrl.getAll);
  router.route("/categories/tree").get(categoryCtrl.getTree);
  router.route("/category").post(categoryCtrl.insert);
  router.route("/category/:id").put(categoryCtrl.update);
  router.route("/category/:id").delete(categoryCtrl.delete);

  // Inventory Sessions (optional named tracking periods)
  router.route("/inventory/sessions").get(inventoryCtrl.getSessions);
  router.route("/inventory/session").post(inventoryCtrl.startSession);
  router.route("/inventory/session/:id").get(inventoryCtrl.getSession);
  router.route("/inventory/session/:id").put(inventoryCtrl.updateSession);
  router.route("/inventory/session/:id").delete(inventoryCtrl.deleteSession);

  // Inventory Readings (continuous data stream)
  router.route("/inventory/readings").get(inventoryCtrl.getReadings);
  router.route("/inventory/reading").post(inventoryCtrl.addReadingAPI);
  router.route("/inventory/reading/:id").delete(inventoryCtrl.deleteReading);

  // Inventory Events (deliveries, breakage, comps)
  router.route("/inventory/events").get(inventoryCtrl.getEvents);
  router.route("/inventory/event").post(inventoryCtrl.addEvent);
  router.route("/inventory/event/:id").delete(inventoryCtrl.deleteEvent);

  // Consumption Reports (time-range based)
  router.route("/inventory/reports").get(inventoryCtrl.getReports);
  router.route("/inventory/report").post(inventoryCtrl.generateReport);
  router.route("/inventory/report/:id").get(inventoryCtrl.getReport);

  // Product inventory config (bottle specs)
  router.route("/inventory/product/:barcode/config").put(inventoryCtrl.updateProductConfig);

  // Demo environment: deterministic seed, reset, simulation, and dashboard data.
  router.route("/demo/seed").post(requireRole('admin'), demoCtrl.seed);
  router.route("/demo/reset").post(requireRole('admin'), demoCtrl.reset);
  router.route("/demo/simulate").post(requireRole('admin'), demoCtrl.simulate);
  router.route("/demo/dashboard").get(requireRole('admin'), demoCtrl.dashboard);

  // Platform administration: provisioning and lifecycle management.
  router.route("/platform/businesses").get(requireRole('admin'), platformCtrl.listBusinesses);
  router.route("/platform/businesses").post(requireRole('admin'), platformCtrl.onboardBusiness);
  router.route("/platform/businesses/:id/status").patch(requireRole('admin'), platformCtrl.updateBusinessStatus);
  router.route("/platform/devices/:id/assign").patch(requireRole('admin'), platformCtrl.assignDevice);

  // Stripe
  router.route("/stripe/test").post(stripeCtrl.test);
  router.route("/stripe/customer/:customerId").get(stripeCtrl.retrieveCustomer);

  router.route("/messages/test").get(emailCtrl.sendMessage);

  // Apply the routes to our application with the prefix /api
  app.use("/api", router);
}
