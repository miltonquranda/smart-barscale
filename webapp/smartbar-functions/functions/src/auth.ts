import * as jwt from 'jsonwebtoken';
import { db } from './firebase';

/**
 * Authentication and authorisation for the SmartBar API.
 *
 * The previous middleware verified a token if one was present but called
 * next() on every path — including a missing token, an invalid signature and a
 * deleted user. Nothing was ever rejected at the middleware layer, so any route
 * that forgot its own check was effectively public. Several were: the product
 * catalog could be rewritten by anyone who could reach the function.
 *
 * The model here:
 *   - `attachIdentity` runs on every request and *populates* req.user /
 *     req.device when a valid token is present. It never rejects, so public
 *     routes still work.
 *   - `requireAuth` rejects anything that reached a protected route without an
 *     identity. Applied by default; public routes opt out explicitly.
 *   - `requireRole` layers role checks on top.
 *
 * Tokens now expire. Devices already handle this: the firmware clears its saved
 * token and re-logs-in on a 401/403 from POST /api/bottle-stats.
 */

/** Users re-authenticate daily; short enough to limit a stolen token. */
export const USER_TOKEN_TTL = '12h';
/**
 * Devices are unattended and re-login automatically, but a long TTL limits the
 * blast radius if a scale is stolen from a bar.
 */
export const DEVICE_TOKEN_TTL = '30d';

function secret(): string {
  const value = process.env.SECRET_TOKEN;
  if (!value) {
    // Failing loudly beats signing tokens with "undefined", which would make
    // every token forgeable.
    throw new Error('SECRET_TOKEN is not configured. Set it in functions/.env.');
  }
  return value;
}

export function signUserToken(user: any): string {
  // Only identifiers go in the token. The previous implementation embedded the
  // whole user document including populated business records, which went stale
  // the moment anything was edited and bloated every request header.
  return jwt.sign(
    { typ: 'user', uid: user._id, role: user.role || null },
    secret(),
    { expiresIn: USER_TOKEN_TTL },
  );
}

export function signDeviceToken(device: any): string {
  return jwt.sign(
    { typ: 'device', did: device._id, serialNumber: device.serialNumber },
    secret(),
    { expiresIn: DEVICE_TOKEN_TTL },
  );
}

/** Password-reset links are single-purpose and short-lived. */
export function signPasswordResetToken(user: any): string {
  return jwt.sign({ typ: 'pwreset', uid: user._id }, secret(), { expiresIn: '2h' });
}

export function verifyToken(token: string): any | null {
  try {
    return jwt.verify(token, secret());
  } catch (err) {
    return null;
  }
}

function extractToken(req: any): string | null {
  const header = req.headers?.authorization;
  if (typeof header === 'string' && header.trim()) {
    const parts = header.trim().split(/\s+/);
    // Accept "Bearer <t>", "token <t>" (the React client) and a bare token.
    return parts.length > 1 ? parts[parts.length - 1] : parts[0];
  }
  if (req.body?.token) return String(req.body.token);
  return null;
}

async function loadUser(uid: string) {
  const doc = await db.collection('users').doc(uid).get();
  if (!doc.exists) return null;

  const user: any = { _id: doc.id, ...doc.data() };
  delete user.password;

  // A suspended or offboarded account must stop working immediately, even if
  // its token is still cryptographically valid.
  if (user.status && user.status !== 'active') return null;

  if (Array.isArray(user.business) && user.business.length) {
    const docs = await Promise.all(
      user.business.map((id: string) => db.collection('businesses').doc(id).get()),
    );
    user.business = docs.filter(d => d.exists).map(d => ({ _id: d.id, ...d.data() }));
  } else {
    user.business = [];
  }
  return user;
}

async function loadDevice(did: string) {
  const doc = await db.collection('devices').doc(did).get();
  if (!doc.exists) return null;
  return { _id: doc.id, ...doc.data() } as any;
}

/**
 * Populate req.user / req.device from a valid token. Never rejects — routes
 * decide whether an identity is required.
 */
export const attachIdentity = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const payload = verifyToken(token);
    if (!payload) return next();

    if (payload.typ === 'user' && payload.uid) {
      req.user = await loadUser(payload.uid);
    } else if (payload.typ === 'device' && payload.did) {
      req.device = await loadDevice(payload.did);
    } else if (payload.typ === 'pwreset' && payload.uid) {
      // Deliberately not a general-purpose identity: only the password-reset
      // route reads this, so a reset link cannot be used as a session token.
      req.passwordReset = await loadUser(payload.uid);
    } else if (payload.user?._id) {
      // Legacy token issued before this refactor. Honour it so existing
      // sessions survive one deploy, then it expires naturally.
      req.user = await loadUser(payload.user._id);
    } else if (payload.serialNumber?._id) {
      req.device = await loadDevice(payload.serialNumber._id);
    }
    next();
  } catch (err) {
    console.error('Identity resolution failed:', err);
    next();
  }
};

/** Reject requests that carry no valid user or device identity. */
export const requireAuth = (req, res, next) => {
  if (req.user || req.device) return next();
  res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
};

/** Reject anything that isn't an authenticated *user* (not a device). */
export const requireUser = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
};

/**
 * Role check. Platform admins ('admin' / 'platform_admin') pass any role gate.
 * Returns 403, not 401: the caller is authenticated, just not permitted — and
 * the client only clears a session on 401.
 */
export const requireRole = (...roles: string[]) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
  }
  const role = req.user.role;
  const isPlatformAdmin = role === 'admin' || role === 'platform_admin';
  if (isPlatformAdmin || roles.includes(role)) return next();
  res.status(403).json({ error: 'You do not have permission to do that.', code: 'FORBIDDEN' });
};

/**
 * Restrict a /business/:id route to members of that business.
 *
 * The old implementation derived the model name from req.route.path and only
 * guarded routes whose first segment was literally "business", which meant it
 * silently did nothing on every other route it was attached to.
 */
export const requireBusinessMember = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
  }
  const role = req.user.role;
  if (role === 'admin' || role === 'platform_admin') return next();

  const target = req.params.id;
  const isMember = Array.isArray(req.user.business)
    && req.user.business.some((b: any) => String(b._id || b) === String(target));
  if (isMember) return next();

  res.status(403).json({ error: 'That business is not associated with your account.', code: 'FORBIDDEN' });
};

/** Shared business-scope resolution used across inventory controllers. */
export function getBusinessId(req: any): string | null {
  if (req.user?.business?.[0]?._id) return req.user.business[0]._id;
  if (req.user?.business?.[0]) return req.user.business[0];
  if (req.device?.business) return req.device.business;
  return null;
}
