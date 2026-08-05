import * as dotenv from "dotenv";
import * as jwt from "jsonwebtoken";
import * as bcrypt from "bcryptjs";
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
      console.log(`Attempting login for ${req.body.email}`);
      const snapshot = await db.collection(this.collectionName).where('email', '==', req.body.email).limit(1).get();
      if (snapshot.empty) {
        console.log('User not found in database');
        return res.status(403).json({ error: 'User not found' });
      }

      const doc = snapshot.docs[0];
      const user: any = { _id: doc.id, ...doc.data() };
      console.log('User found:', user.email, 'Hash:', user.password);

      const isMatch = await bcrypt.compare(req.body.password, user.password);
      if (!isMatch) {
        console.log('Password mismatch');
        return res.status(403).json({ error: 'Invalid password' });
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

      // Remove password from token payload
      delete user.password;
      const token = jwt.sign({ user: user }, process.env.SECRET_TOKEN);
      res.status(200).json({ token: token, user: user });
    } catch (err) {
      console.error(err);
      res.sendStatus(403);
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

      const token = jwt.sign({ user: user }, process.env.SECRET_TOKEN, { expiresIn: "2h" });
      this.emailCtrl.passwordReset(email, token).then(emailRes => {
        res.status(200).json({ token, emailRes });
      });
    } catch (err) {
      console.error(err);
      res.sendStatus(403);
    }
  };

  passwordResetVerify = async (req, res) => {
    if (req.user) {
      const user = req.user;
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
        const token = jwt.sign({ user: updatedUser }, process.env.SECRET_TOKEN);
        res.status(200).json({ token });
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
                  const authToken = jwt.sign({ user: user }, process.env.SECRET_TOKEN as string);
                  res.status(200).json({ token: authToken });
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
