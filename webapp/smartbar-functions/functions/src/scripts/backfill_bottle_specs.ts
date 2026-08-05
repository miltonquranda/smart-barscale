/**
 * Backfill bottle_volume_ml / bottle_empty_weight_g / bottle_full_weight_g on
 * the existing catalog.
 *
 * Why this exists: the inventory engine converts a scale reading into a liquid
 * volume using (weight - empty) / (full - empty) * volume. Products imported
 * before these fields were writable have none of them, so every derived figure
 * is zero. This derives what it safely can and reports what it cannot.
 *
 * IMPORTANT — read before running:
 *
 *   Volume is parsed from the existing `quantity` string and is reliable.
 *
 *   Empty-bottle weight is *estimated* from typical glass weights by format.
 *   Real bottles vary by well over 100g depending on punt depth and glass
 *   thickness. An estimate is good enough to make the dashboard functional and
 *   to spot gross anomalies, but it is NOT good enough for the variance numbers
 *   a bar would act on. Every product this touches is marked
 *   `specs_estimated: true` so it can be found and replaced with a real
 *   measurement later.
 *
 *   Weigh your actual bottles before trusting pour-cost figures.
 *
 * Usage:
 *   npm run build
 *   node lib/scripts/backfill_bottle_specs.js --dry-run
 *   node lib/scripts/backfill_bottle_specs.js --commit
 *   node lib/scripts/backfill_bottle_specs.js --commit --overwrite-estimates
 */

import { db } from '../firebase';

const DENSITY_G_PER_ML = 0.94;   // typical 40% ABV spirit

/**
 * Typical empty glass weight by nominal bottle volume, in grams.
 * Sourced from common commercial bottle formats; treat as a starting point.
 */
const EMPTY_WEIGHT_BY_VOLUME: { maxMl: number; grams: number }[] = [
  { maxMl: 60, grams: 55 },
  { maxMl: 200, grams: 180 },
  { maxMl: 375, grams: 300 },
  { maxMl: 500, grams: 400 },
  { maxMl: 750, grams: 500 },
  { maxMl: 1000, grams: 620 },
  { maxMl: 1750, grams: 900 },
  { maxMl: Infinity, grams: 1000 },
];

/** Parse a liquid volume in ml out of a free-text quantity string. */
export function parseVolumeMl(quantity: any, weight: any): number | null {
  const q = String(quantity ?? '').trim();
  if (!q) return fromWeight(weight);

  const num = Number(q.match(/[0-9]+(?:\.[0-9]+)?/)?.[0] ?? NaN);
  if (!Number.isFinite(num)) return fromWeight(weight);

  // Order matters, and no leading \b: there is no word boundary between a
  // digit and a letter, so /\bl\b/ never matches "1.75L". Check the longer,
  // more specific units first so "ml" and "cl" aren't swallowed by "l".
  if (/\d\s*(ml|millilit(er|re)s?)\b/i.test(q)) return Math.round(num);
  if (/\d\s*cl\b/i.test(q)) return Math.round(num * 10);
  if (/\d\s*(fl\.?\s?oz|oz|ounces?)\b/i.test(q)) return Math.round(num * 29.5735);
  if (/\d\s*(l|lt|ltr|liters?|litres?)\b/i.test(q)) return Math.round(num * 1000);

  // Bare number. Some imports use quantity="1" as a bottle *count* with the
  // real volume in `weight`, so only trust a bare number if it is plausible
  // as millilitres.
  if (num >= 50) return Math.round(num);
  return fromWeight(weight);
}

function fromWeight(weight: any): number | null {
  const num = Number(String(weight ?? '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0] ?? NaN);
  if (!Number.isFinite(num) || num < 50) return null;
  return Math.round(num);
}

export function estimateEmptyWeight(volumeMl: number): number {
  return (EMPTY_WEIGHT_BY_VOLUME.find(r => volumeMl <= r.maxMl) as any).grams;
}

export function deriveSpecs(bottle: any) {
  const volumeMl = parseVolumeMl(bottle.quantity, bottle.weight);
  if (!volumeMl) return null;
  const emptyWeight = estimateEmptyWeight(volumeMl);
  const fullWeight = Math.round(emptyWeight + volumeMl * DENSITY_G_PER_ML);
  return { bottle_volume_ml: volumeMl, bottle_empty_weight_g: emptyWeight, bottle_full_weight_g: fullWeight };
}

/**
 * Turn Google Cloud credential failures into something actionable.
 *
 * The raw gRPC error is a 30-line stack trace ending in an OAuth error code,
 * which says nothing about what to actually do.
 */
function explainAuthError(err: any): string | null {
  const detail = `${err?.details || ''} ${err?.message || ''}`;

  if (detail.includes('invalid_rapt') || detail.includes('reauth')) {
    return [
      'Google Cloud needs you to re-authenticate.',
      '',
      'Your Application Default Credentials are still present but have gone stale —',
      'this normally means your organisation requires periodic reauthentication.',
      '',
      'Fix:',
      '  gcloud auth application-default login',
      '',
      'Then run this command again.',
    ].join('\n');
  }

  if (detail.includes('Could not load the default credentials')
      || detail.includes('could not find default credentials')) {
    return [
      'No Google Cloud credentials found.',
      '',
      'Pick one:',
      '  gcloud auth application-default login          # your own account',
      '  export GOOGLE_APPLICATION_CREDENTIALS=key.json # a service account key',
    ].join('\n');
  }

  if (detail.includes('invalid_grant')) {
    return [
      'Google Cloud rejected the stored credentials (invalid_grant).',
      'They have most likely expired or been revoked.',
      '',
      'Fix:',
      '  gcloud auth application-default login',
    ].join('\n');
  }

  if (detail.includes('PERMISSION_DENIED') || err?.code === 7) {
    return [
      'Authenticated, but this account lacks permission to read Firestore.',
      'It needs at least roles/datastore.viewer (and roles/datastore.user to --commit).',
    ].join('\n');
  }

  return null;
}

/**
 * Resolve and report the target project before touching anything.
 *
 * `firebase.ts` calls initializeApp() without an explicit projectId, so when
 * this runs outside Cloud Functions the project comes from whatever ADC happens
 * to point at. For a script that rewrites 4,000+ catalog documents, silently
 * targeting the wrong project is a genuinely bad outcome — so it is printed,
 * and a --commit run against an unexpected project has to be confirmed.
 */
async function confirmTarget(commit: boolean) {
  const projectId = await (db as any)._getProjectId?.().catch(() => null)
    ?? process.env.GOOGLE_CLOUD_PROJECT
    ?? process.env.GCLOUD_PROJECT
    ?? '(unknown)';

  console.log(`Target project: ${projectId}`);
  const expected = process.env.SMARTBAR_PROJECT_ID;
  if (expected && projectId !== expected && projectId !== '(unknown)') {
    console.error(
      `\nRefusing to run: SMARTBAR_PROJECT_ID is "${expected}" but credentials `
      + `resolve to "${projectId}".`
    );
    process.exit(1);
  }
  if (commit && projectId === '(unknown)') {
    console.error(
      '\nRefusing to --commit: could not determine which project these credentials '
      + 'point at. Set GOOGLE_CLOUD_PROJECT explicitly.'
    );
    process.exit(1);
  }
  console.log('');
}

async function main() {
  const commit = process.argv.includes('--commit');
  const overwriteEstimates = process.argv.includes('--overwrite-estimates');

  console.log(commit
    ? 'COMMIT MODE — this will write to the catalog.\n'
    : 'DRY RUN — no writes. Pass --commit to apply.\n');

  await confirmTarget(commit);

  const snapshot = await db.collection('bottles').get();
  console.log(`Scanning ${snapshot.size} catalog products…\n`);

  let alreadySet = 0, derived = 0, skipped = 0, reEstimated = 0;
  const failures: { id: string; name: string; quantity: any }[] = [];
  const batchOps: { ref: any; data: any }[] = [];

  for (const doc of snapshot.docs) {
    const b: any = doc.data();
    const hasAll = Number(b.bottle_volume_ml) > 0
      && Number(b.bottle_empty_weight_g) > 0
      && Number(b.bottle_full_weight_g) > 0;

    // Never overwrite a real measurement. Only revisit our own estimates, and
    // only when explicitly asked.
    if (hasAll && !(overwriteEstimates && b.specs_estimated)) { alreadySet++; continue; }
    if (hasAll && overwriteEstimates && b.specs_estimated) reEstimated++;

    const specs = deriveSpecs(b);
    if (!specs) {
      skipped++;
      failures.push({ id: doc.id, name: b.name || '(unnamed)', quantity: b.quantity });
      continue;
    }

    derived++;
    batchOps.push({
      ref: doc.ref,
      data: {
        ...specs,
        specs_estimated: true,
        specs_estimated_at: new Date(),
        specs_estimate_note: 'Empty-bottle weight estimated by format. Replace with a measured value.',
      },
    });
  }

  if (commit) {
    for (let i = 0; i < batchOps.length; i += 400) {
      const batch = db.batch();
      batchOps.slice(i, i + 400).forEach(op => batch.update(op.ref, op.data));
      await batch.commit();
      console.log(`  committed ${Math.min(i + 400, batchOps.length)}/${batchOps.length}`);
    }
  }

  console.log('\n─── Summary ──────────────────────────────');
  console.log(`  already had real specs : ${alreadySet}`);
  console.log(`  estimates derived      : ${derived}${reEstimated ? ` (${reEstimated} re-estimated)` : ''}`);
  console.log(`  could not derive       : ${skipped}`);
  console.log(`  ${commit ? 'WRITTEN' : 'not written (dry run)'}`);

  if (failures.length) {
    console.log(`\n─── Needs manual entry (${failures.length}) ───`);
    failures.slice(0, 40).forEach(f => console.log(`  ${f.id}  ${f.name}  quantity=${JSON.stringify(f.quantity)}`));
    if (failures.length > 40) console.log(`  … and ${failures.length - 40} more`);
  }

  console.log('\nReminder: empty-bottle weights are estimates. Weigh real bottles');
  console.log('before relying on pour-cost or variance figures.');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      const friendly = explainAuthError(err);
      if (friendly) {
        console.error(`\n${friendly}\n`);
        // The stack adds nothing once the cause is known; keep it behind a flag.
        if (process.argv.includes('--verbose')) console.error(err);
      } else {
        console.error(err);
      }
      process.exit(1);
    });
}
