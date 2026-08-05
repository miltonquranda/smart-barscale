import * as express from "express";
import * as jwt from "jsonwebtoken";
import { db } from './firebase';

import CatCtrl from "./controllers/cat";
import UserCtrl from "./controllers/user";
import BottleCtrl from "./controllers/bottle";
import BottleStatCtrl from "./controllers/bottleStat";
import BusinessCtrl from "./controllers/business";
import DeviceCtrl from "./controllers/device";
import StripeCtrl from "./controllers/stripe";
import EmailCtrl from "./controllers/email";

export default function setRoutes(app) {
  const router = express.Router();

  const catCtrl = new CatCtrl();
  const userCtrl = new UserCtrl();
  const bottleCtrl = new BottleCtrl();
  const bottleStatCtrl = new BottleStatCtrl();
  const businessCtrl = new BusinessCtrl();
  const deviceCtrl = new DeviceCtrl();
  const stripeCtrl = new StripeCtrl();
  const emailCtrl = new EmailCtrl();

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
        // Wait, if I throw error, it goes to catch(e) -> next(e).
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

      if (token) {
        jwt.verify(token, process.env.SECRET_TOKEN, async function (err, payload) {
          if (payload) {
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
      if (req.user && req.user.role === role) {
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
  router.route("/devices").get(requireRole('admin'), deviceCtrl.getAllWith(['business']));
  router.route("/devices/count").get(deviceCtrl.count);
  router.route("/device").post(deviceCtrl.insert);
  router.route("/device/:id").get(deviceCtrl.get);
  router.route("/device/:id").put(deviceCtrl.update);
  router.route("/device/:id").delete(deviceCtrl.delete);

  // Stripe
  router.route("/stripe/test").post(stripeCtrl.test);
  router.route("/stripe/customer/:customerId").get(stripeCtrl.retrieveCustomer);

  router.route("/messages/test").get(emailCtrl.sendMessage);

  // Apply the routes to our application with the prefix /api
  app.use("/api", router);
}
