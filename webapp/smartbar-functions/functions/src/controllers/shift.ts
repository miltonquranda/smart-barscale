import { db } from '../firebase';
import * as admin from 'firebase-admin';

const SHIFTS = 'shifts';

/**
 * Shift definitions for a business.
 *
 * A shift is a recurring local-time window (e.g. "Evening", 16:00–00:00) with
 * an assigned staff member. Consumption is attributed to a shift by comparing
 * the reading's timestamp — converted into the business's local timezone — to
 * each window. This is deliberately a *schedule* model, not a clock-in model:
 * it needs no extra device interaction, but it means attribution is only as
 * accurate as the schedule. If two people work the same window, the shift owns
 * the numbers, not the individual.
 *
 * Windows may cross midnight (start_hour 22, end_hour 2). Windows must not
 * overlap within a business, or a reading would be double-counted; `validate`
 * enforces that on write.
 */

export interface ShiftDef {
  _id?: string;
  business: string;
  name: string;
  staff_name: string;
  start_hour: number;   // 0–23, local to the business timezone
  end_hour: number;     // 0–23, exclusive; may be <= start_hour to cross midnight
  days: number[];       // 0=Sun … 6=Sat. Empty means every day.
  target_pour_cost_pct: number | null;
  active: boolean;
  color: string | null;
}

/** Minutes since local midnight for a shift boundary. */
const hourToMin = (h: number) => Math.round(h * 60);

/**
 * True if a local time (minutes since midnight) falls inside the window.
 * Handles windows that wrap past midnight.
 */
export function inWindow(localMinutes: number, startHour: number, endHour: number): boolean {
  const start = hourToMin(startHour);
  const end = hourToMin(endHour);
  if (start === end) return true;            // 24-hour shift
  if (start < end) return localMinutes >= start && localMinutes < end;
  return localMinutes >= start || localMinutes < end;  // wraps midnight
}

/**
 * Convert a Date into {minutes since local midnight, local day-of-week} for a
 * given IANA timezone. Uses Intl rather than a date library so there is no new
 * dependency; falls back to UTC if the timezone string is invalid.
 */
export function localParts(date: Date, timeZone: string): { minutes: number; dow: number; ymd: string } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).formatToParts(date);
  } catch (_) {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).formatToParts(date);
  }
  const get = (t: string) => parts.find(p => p.type === t)?.value || '0';
  // Intl returns "24" for midnight under hour12:false in some runtimes.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minutes: hour * 60 + minute,
    dow: dowMap[get('weekday')] ?? 0,
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** Pick the shift definition that owns a given instant. Null if none match. */
export function shiftForDate(date: Date, shifts: ShiftDef[], timeZone: string): ShiftDef | null {
  const { minutes, dow } = localParts(date, timeZone);
  for (const s of shifts) {
    if (!s.active) continue;
    if (s.days && s.days.length && !s.days.includes(dow)) continue;
    if (inWindow(minutes, s.start_hour, s.end_hour)) return s;
  }
  return null;
}

const DEFAULT_COLORS = ['#28a745', '#f0ad4e', '#dc3545', '#007bff', '#6f42c1', '#17a2b8'];

// Returns { error } on failure, { value } on success. A discriminated union
// would be cleaner, but this project compiles with `strict: false`, which
// disables the narrowing that pattern relies on.
interface ValidationResult {
  error: string | null;
  value: Omit<ShiftDef, 'business'> | null;
}

function validate(body: any): ValidationResult {
  const fail = (error: string): ValidationResult => ({ error, value: null });

  const name = String(body?.name || '').trim();
  if (!name) return fail('name is required');

  const startHour = Number(body?.start_hour);
  const endHour = Number(body?.end_hour);
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    return fail('start_hour must be an integer 0–23');
  }
  if (!Number.isInteger(endHour) || endHour < 0 || endHour > 23) {
    return fail('end_hour must be an integer 0–23');
  }

  const days = Array.isArray(body?.days)
    ? body.days.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6)
    : [];

  const target = body?.target_pour_cost_pct;
  const targetPct = target === null || target === undefined || target === ''
    ? null
    : Number(target);
  if (targetPct !== null && (!Number.isFinite(targetPct) || targetPct < 0 || targetPct > 100)) {
    return fail('target_pour_cost_pct must be between 0 and 100');
  }

  return {
    error: null,
    value: {
      name,
      staff_name: String(body?.staff_name || '').trim(),
      start_hour: startHour,
      end_hour: endHour,
      days,
      target_pour_cost_pct: targetPct,
      active: body?.active === undefined ? true : Boolean(body.active),
      color: body?.color || null,
    },
  };
}

/** Reject a new/edited window that overlaps an existing one on a shared day. */
function overlaps(a: Omit<ShiftDef, 'business'>, b: ShiftDef): boolean {
  const sharedDay = !a.days.length || !b.days.length || a.days.some(d => b.days.includes(d));
  if (!sharedDay) return false;
  // Sample the window at 15-minute resolution; simpler and safer than interval
  // arithmetic on wrapping ranges, and cheap at this size.
  for (let m = 0; m < 24 * 60; m += 15) {
    if (inWindow(m, a.start_hour, a.end_hour) && inWindow(m, b.start_hour, b.end_hour)) return true;
  }
  return false;
}

export default class ShiftCtrl {
  getBusinessId(req: any): string | null {
    if (req.user?.business?.[0]?._id) return req.user.business[0]._id;
    if (req.user?.business?.[0]) return req.user.business[0];
    if (req.device?.business) return req.device.business;
    return null;
  }

  /** All shift definitions for a business, ordered by start of window. */
  static async listForBusiness(business: string): Promise<ShiftDef[]> {
    const snap = await db.collection(SHIFTS).where('business', '==', business).get();
    return snap.docs
      .map(d => ({ _id: d.id, ...d.data() } as ShiftDef))
      .sort((a, b) => a.start_hour - b.start_hour);
  }

  getAll = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business associated with this account.' });
      res.status(200).json(await ShiftCtrl.listForBusiness(business));
    } catch (err) {
      console.error('Shift list failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  insert = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business associated with this account.' });

      const parsed = validate(req.body);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const existing = await ShiftCtrl.listForBusiness(business);
      const clash = existing.find(s => s.active && parsed.value.active && overlaps(parsed.value, s));
      if (clash) return res.status(409).json({ error: `Window overlaps the "${clash.name}" shift. Shifts may not overlap.` });

      const color = parsed.value.color || DEFAULT_COLORS[existing.length % DEFAULT_COLORS.length];
      const ref = await db.collection(SHIFTS).add({
        business, ...parsed.value, color,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      const doc = await ref.get();
      res.status(201).json({ _id: doc.id, ...doc.data() });
    } catch (err) {
      console.error('Shift create failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  update = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business associated with this account.' });

      const doc = await db.collection(SHIFTS).doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Shift not found' });
      if (doc.data().business !== business) return res.status(404).json({ error: 'Shift not found' });

      const parsed = validate({ ...doc.data(), ...req.body });
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const existing = (await ShiftCtrl.listForBusiness(business)).filter(s => s._id !== req.params.id);
      const clash = existing.find(s => s.active && parsed.value.active && overlaps(parsed.value, s));
      if (clash) return res.status(409).json({ error: `Window overlaps the "${clash.name}" shift. Shifts may not overlap.` });

      await doc.ref.update({ ...parsed.value, updated_at: admin.firestore.FieldValue.serverTimestamp() });
      const updated = await doc.ref.get();
      res.status(200).json({ _id: updated.id, ...updated.data() });
    } catch (err) {
      console.error('Shift update failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  delete = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business associated with this account.' });

      const doc = await db.collection(SHIFTS).doc(req.params.id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Shift not found' });
      if (doc.data().business !== business) return res.status(404).json({ error: 'Shift not found' });

      await doc.ref.delete();
      res.sendStatus(200);
    } catch (err) {
      console.error('Shift delete failed:', err);
      res.status(500).json({ error: err.message });
    }
  };

  /**
   * Create a conventional three-shift day so a new business has something to
   * attribute against. Staff names are left blank on purpose — an empty name
   * renders as the shift name rather than inventing a person.
   */
  seedDefaults = async (req, res) => {
    try {
      const business = this.getBusinessId(req);
      if (!business) return res.status(400).json({ error: 'No business associated with this account.' });

      const existing = await ShiftCtrl.listForBusiness(business);
      if (existing.length) return res.status(409).json({ error: 'This business already has shifts defined.' });

      const defaults = [
        { name: 'Day', start_hour: 8, end_hour: 16, color: '#28a745' },
        { name: 'Evening', start_hour: 16, end_hour: 0, color: '#f0ad4e' },
        { name: 'Late Night', start_hour: 0, end_hour: 8, color: '#dc3545' },
      ];
      const batch = db.batch();
      defaults.forEach(d => {
        batch.set(db.collection(SHIFTS).doc(), {
          business, staff_name: '', days: [], target_pour_cost_pct: 20,
          active: true, ...d, created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      res.status(201).json(await ShiftCtrl.listForBusiness(business));
    } catch (err) {
      console.error('Shift seed failed:', err);
      res.status(500).json({ error: err.message });
    }
  };
}
