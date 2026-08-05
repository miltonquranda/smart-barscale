"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jwt = __importStar(require("jsonwebtoken"));
const bcrypt = __importStar(require("bcryptjs"));
const firebase_1 = require("../firebase");
const base_1 = __importDefault(require("./base"));
const stripe_1 = __importDefault(require("./stripe"));
const email_1 = __importDefault(require("./email"));
class UserCtrl extends base_1.default {
    constructor() {
        super(...arguments);
        this.collectionName = 'users';
        this.stripeCtrl = new stripe_1.default();
        this.emailCtrl = new email_1.default();
        this.login = async (req, res) => {
            try {
                console.log(`Attempting login for ${req.body.email}`);
                const snapshot = await firebase_1.db.collection(this.collectionName).where('email', '==', req.body.email).limit(1).get();
                if (snapshot.empty) {
                    console.log('User not found in database');
                    return res.status(403).json({ error: 'User not found' });
                }
                const doc = snapshot.docs[0];
                const user = Object.assign({ _id: doc.id }, doc.data());
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
                        const bDoc = await firebase_1.db.collection('businesses').doc(bizId).get();
                        if (bDoc.exists)
                            businesses.push(Object.assign({ _id: bDoc.id }, bDoc.data()));
                    }
                    user.business = businesses;
                }
                // Remove password from token payload
                delete user.password;
                const token = jwt.sign({ user: user }, process.env.SECRET_TOKEN);
                res.status(200).json({ token: token, user: user });
            }
            catch (err) {
                console.error(err);
                res.sendStatus(403);
            }
        };
        this.passwordResetRequest = async (req, res) => {
            const email = req.body.email;
            try {
                const snapshot = await firebase_1.db.collection(this.collectionName).where('email', '==', email).limit(1).get();
                if (snapshot.empty) {
                    return res.sendStatus(403);
                }
                const doc = snapshot.docs[0];
                const user = Object.assign({ _id: doc.id }, doc.data());
                // Populate business
                if (user.business && user.business.length > 0) {
                    const businesses = [];
                    for (const bizId of user.business) {
                        const bDoc = await firebase_1.db.collection('businesses').doc(bizId).get();
                        if (bDoc.exists)
                            businesses.push(Object.assign({ _id: bDoc.id }, bDoc.data()));
                    }
                    user.business = businesses;
                }
                const token = jwt.sign({ user: user }, process.env.SECRET_TOKEN, { expiresIn: "2h" });
                this.emailCtrl.passwordReset(email, token).then(emailRes => {
                    res.status(200).json({ token, emailRes });
                });
            }
            catch (err) {
                console.error(err);
                res.sendStatus(403);
            }
        };
        this.passwordResetVerify = async (req, res) => {
            if (req.user) {
                const user = req.user;
                const salt = await bcrypt.genSalt(10);
                const hash = await bcrypt.hash(req.body.password, salt);
                try {
                    await firebase_1.db.collection(this.collectionName).doc(user._id).update({ password: hash });
                    // Fetch updated user to sign token
                    const doc = await firebase_1.db.collection(this.collectionName).doc(user._id).get();
                    const updatedUser = Object.assign({ _id: doc.id }, doc.data());
                    // Populate business
                    if (updatedUser.business && updatedUser.business.length > 0) {
                        const businesses = [];
                        for (const bizId of updatedUser.business) {
                            const bDoc = await firebase_1.db.collection('businesses').doc(bizId).get();
                            if (bDoc.exists)
                                businesses.push(Object.assign({ _id: bDoc.id }, bDoc.data()));
                        }
                        updatedUser.business = businesses;
                    }
                    delete updatedUser.password;
                    const token = jwt.sign({ user: updatedUser }, process.env.SECRET_TOKEN);
                    res.status(200).json({ token });
                }
                catch (err) {
                    console.error(err);
                    res.status(400).json({ error: err.message });
                }
            }
            else {
                res.status(400).json({ message: "token has expired" });
            }
        };
        this.insert = async (req, res) => {
            try {
                const salt = await bcrypt.genSalt(10);
                const hash = await bcrypt.hash(req.body.password, salt);
                const newUser = {
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
                    const bSnapshot = await firebase_1.db.collection('businesses').where('name', '==', req.body.business[0].name).limit(1).get();
                    let businessId;
                    let businessData;
                    if (!bSnapshot.empty) {
                        businessId = bSnapshot.docs[0].id;
                        businessData = bSnapshot.docs[0].data();
                    }
                    else {
                        // Create business
                        const bRef = await firebase_1.db.collection('businesses').add(req.body.business[0]);
                        businessId = bRef.id;
                        businessData = req.body.business[0];
                        // Create device for business
                        await firebase_1.db.collection('devices').add({
                            business: businessId,
                            type: 'scan-scale'
                        });
                    }
                    newUser.business.push(businessId);
                    // Save user
                    const uRef = await firebase_1.db.collection(this.collectionName).add(newUser);
                    const uDoc = await uRef.get();
                    const savedUser = Object.assign(Object.assign({ _id: uDoc.id }, uDoc.data()), { business: [Object.assign({ _id: businessId }, businessData)] }); // Return populated business
                    this.handleUserSave(savedUser, res, req.body.token);
                }
                else {
                    const uRef = await firebase_1.db.collection(this.collectionName).add(newUser);
                    const uDoc = await uRef.get();
                    const savedUser = Object.assign({ _id: uDoc.id }, uDoc.data());
                    this.handleUserSave(savedUser, res);
                }
            }
            catch (err) {
                console.error(err);
                res.status(400).json({ error: err.message });
            }
        };
        this.get = async (req, res) => {
            try {
                const doc = await firebase_1.db.collection(this.collectionName).doc(req.params.id).get();
                if (!doc.exists) {
                    return res.sendStatus(404);
                }
                const user = Object.assign({ _id: doc.id }, doc.data());
                delete user.password;
                if (user.business && user.business.length > 0) {
                    const businesses = [];
                    for (const bizId of user.business) {
                        const bDoc = await firebase_1.db.collection('businesses').doc(bizId).get();
                        if (bDoc.exists)
                            businesses.push(Object.assign({ _id: bDoc.id }, bDoc.data()));
                    }
                    user.business = businesses;
                }
                res.status(200).json(user);
            }
            catch (err) {
                console.error(err);
                res.status(500).json({ error: err.message });
            }
        };
        this.handleUserSave = (user, res, token) => {
            if (token) {
                this.stripeCtrl
                    .createCustomer(user.email, token)
                    .then(customerRes => {
                    const { id } = customerRes;
                    // Update user with customer_id
                    firebase_1.db.collection(this.collectionName).doc(user._id).update({ customer_id: id })
                        .then(() => {
                        user.customer_id = id;
                        this.stripeCtrl.subscription(id, token)
                            .then(() => {
                            delete user.password;
                            const authToken = jwt.sign({ user: user }, process.env.SECRET_TOKEN);
                            res.status(200).json({ token: authToken });
                        })
                            .catch(error => res.status(400).json({ error }));
                    })
                        .catch(err => res.status(400).json({ error: err.message }));
                })
                    .catch(err => res.status(400).json({ error: err }));
            }
            else {
                delete user.password;
                res.status(200).json({ user: user });
            }
        };
    }
}
exports.default = UserCtrl;
//# sourceMappingURL=user.js.map