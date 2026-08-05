import * as bcrypt from "bcryptjs";
import { signUserToken, signPasswordResetToken } from "../auth";
import { db } from '../firebase';
import BaseCtrl from "./base";
import StripeCtrl from "./stripe";
import EmailCtrl from "./email";

export default class UserCtrl extends BaseCtrl {
  collectionName = 'users';
  stripeCtrl = new StripeCtrl();
  emailCtrl = new EmailCtrl();

  login = async (req, res) => {
    try {
      const email = String(req.body.email || '').trim().toLowerCase();
      const snapshot = await db.collection(this.collectionName).where('email', '==', email).limit(1).get();

      // Same message and rough timing for "no such user" and "wrong password",
      // so the endpoint can't be used to enumerate valid email addresses.
      const invalid = () => res.status(401).json({ error: 'Invalid email or password.' });

      if (snapshot.empty) {
        await bcrypt.compare(req.body.password || '', '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
        return invalid();
      }

      const doc = snapshot.docs[0];
      const user: any = { _id: doc.id, ...doc.data() };

      const isMatch = await bcrypt.compare(req.body.password || '', user.password || '');
      if (!isMatch) return invalid();

      if (user.status && user.status !== 'active') {
        return res.status(403).json({ error: 'This account is not active. Contact an administrator.' });
      }

      // Populate business
      if (user.business && user.business.length > 0) {
        const businesses = [];
        for (const bizId of user.business) {
          const bDoc = await db.collection('businesses').doc(bizId).get();
          if (bDoc.exists) businesses.push({ _id: bDoc.id, ...bDoc.data() });
        }
        user.business = businesses;
      }

      delete user.password;
      // The token carries only identifiers; the client gets the user object in
      // the response body for display purposes.
      res.status(200).json({ token: signUserToken(user), user });
    } catch (err) {
      console.error('Login failed:', err);
      res.status(500).json({ error: 'Login failed.' });
    }
  };

  passwordResetRequest = async (req, res) => {
    const email = req.body.email;
    try {
      const snapshot = await db.collection(this.collectionName).where('email', '==', email).limit(1).get();
      if (snapshot.empty) { return res.sendStatus(403); }

      const doc = snapshot.docs[0];
      const user: any = { _id: doc.id, ...doc.data() };

      // Populate business
      if (user.business && user.business.length > 0) {
        const businesses = [];
        for (const bizId of user.business) {
          const bDoc = await db.collection('businesses').doc(bizId).get();
          if (bDoc.exists) businesses.push({ _id: bDoc.id, ...bDoc.data() });
        }
        user.business = businesses;
      }

      const token = signPasswordResetToken(user);
      this.emailCtrl.passwordReset(email, token).then(emailRes => {
        res.status(200).json({ token, emailRes });
      });
    } catch (err) {
      console.error(err);
      res.sendStatus(403);
    }
  };

  passwordResetVerify = async (req, res) => {
    // Only a token minted by passwordResetRequest is accepted here, so an
    // ordinary session token cannot be used to change a password without
    // knowing the current one.
    if (req.passwordReset) {
      const user = req.passwordReset;
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(req.body.password, salt);

      try {
        await db.collection(this.collectionName).doc(user._id).update({ password: hash });

        // Fetch updated user to sign token
        const doc = await db.collection(this.collectionName).doc(user._id).get();
        const updatedUser: any = { _id: doc.id, ...doc.data() };

        // Populate business
        if (updatedUser.business && updatedUser.business.length > 0) {
          const businesses = [];
          for (const bizId of updatedUser.business) {
            const bDoc = await db.collection('businesses').doc(bizId).get();
            if (bDoc.exists) businesses.push({ _id: bDoc.id, ...bDoc.data() });
          }
          updatedUser.business = businesses;
        }

        delete updatedUser.password;
        res.status(200).json({ token: signUserToken(updatedUser) });
      } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message });
      }
    } else {
      res.status(400).json({ message: "token has expired" });
    }
  };

  insert = async (req, res) => {
    try {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(req.body.password, salt);

      const newUser: any = {
        username: req.body.username,
        email: req.body.email,
        password: hash,
        role: req.body.role,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        business: []
      };

      if (req.body.business) {
        // Check if business exists
        const bSnapshot = await db.collection('businesses').where('name', '==', req.body.business[0].name).limit(1).get();
        let businessId;
        let businessData;

        if (!bSnapshot.empty) {
          businessId = bSnapshot.docs[0].id;
          businessData = bSnapshot.docs[0].data();
        } else {
          // Create business
          const bRef = await db.collection('businesses').add(req.body.business[0]);
          businessId = bRef.id;
          businessData = req.body.business[0];

          // Create device for business
          await db.collection('devices').add({
            business: businessId,
            type: 'scan-scale'
          });
        }
        newUser.business.push(businessId);

        // Save user
        const uRef = await db.collection(this.collectionName).add(newUser);
        const uDoc = await uRef.get();
        const savedUser = { _id: uDoc.id, ...uDoc.data(), business: [{ _id: businessId, ...businessData }] }; // Return populated business

        this.handleUserSave(savedUser, res, req.body.token);
      } else {
        const uRef = await db.collection(this.collectionName).add(newUser);
        const uDoc = await uRef.get();
        const savedUser = { _id: uDoc.id, ...uDoc.data() };
        this.handleUserSave(savedUser, res);
      }
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  };

  get = async (req, res) => {
    try {
      const doc = await db.collection(this.collectionName).doc(req.params.id).get();
      if (!doc.exists) { return res.sendStatus(404); }

      const user: any = { _id: doc.id, ...doc.data() };
      delete user.password;

      if (user.business && user.business.length > 0) {
        const businesses = [];
        for (const bizId of user.business) {
          const bDoc = await db.collection('businesses').doc(bizId).get();
          if (bDoc.exists) businesses.push({ _id: bDoc.id, ...bDoc.data() });
        }
        user.business = businesses;
      }

      res.status(200).json(user);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };

  handleUserSave = (user, res, token?: { id: String }) => {
    if (token) {
      this.stripeCtrl
        .createCustomer(user.email, token)
        .then(customerRes => {
          const { id } = customerRes;

          // Update user with customer_id
          db.collection(this.collectionName).doc(user._id).update({ customer_id: id })
            .then(() => {
              user.customer_id = id;
              this.stripeCtrl.subscription(id, token)
                .then(() => {
                  delete user.password;
                  res.status(200).json({ token: signUserToken(user) });
                })
                .catch(error => res.status(400).json({ error }));
            })
            .catch(err => res.status(400).json({ error: err.message }));
        })
        .catch(err => res.status(400).json({ error: err }));
    } else {
      delete user.password;
      res.status(200).json({ user: user });
    }
  };
}
