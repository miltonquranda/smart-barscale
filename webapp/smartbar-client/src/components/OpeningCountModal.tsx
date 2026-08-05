import React, { useEffect, useState } from 'react';
import api from '../api';

interface Row {
  barcode: string;
  name: string;
  hasSpecs: boolean;
  sealed_count: string;
  open_volume_ml: string;
  include: boolean;
}

/**
 * Opening count: establishes the baseline stock position for a business.
 *
 * The dashboard measures consumption as the difference between consecutive
 * readings, so without a starting reading a product shows nothing until it has
 * been scanned twice. Recording an opening count writes that first reading for
 * every product at once.
 *
 * Products missing bottle specs are listed but not selectable — a reading
 * against them would store zeroes and quietly corrupt the totals.
 */
const OpeningCountModal = ({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.get('/bottles')
      .then(resp => {
        const list = (resp.data || []).map((b: any) => ({
          barcode: b.barcode || '',
          name: b.name || 'Unnamed product',
          hasSpecs: Number(b.bottle_full_weight_g) > 0
            && Number(b.bottle_empty_weight_g) > 0
            && Number(b.bottle_volume_ml) > 0,
          sealed_count: '0',
          open_volume_ml: '',
          include: false,
        })).filter((r: Row) => r.barcode);
        setRows(list);
      })
      .catch(err => setError(err?.response?.data?.error || 'Could not load the product catalog.'))
      .finally(() => setLoading(false));
  }, []);

  const update = (barcode: string, patch: Partial<Row>) =>
    setRows(prev => prev.map(r => (r.barcode === barcode ? { ...r, ...patch } : r)));

  const visible = rows.filter(r =>
    !filter.trim() || r.name.toLowerCase().includes(filter.toLowerCase()) || r.barcode.includes(filter));
  const selected = rows.filter(r => r.include && r.hasSpecs);
  const missingSpecs = rows.filter(r => !r.hasSpecs).length;

  const save = async () => {
    if (!selected.length) return;
    setSaving(true);
    setError('');
    try {
      const resp = await api.post('/inventory/opening-count', {
        items: selected.map(r => ({
          barcode: r.barcode,
          sealed_count: parseInt(r.sealed_count) || 0,
          open_volume_ml: r.open_volume_ml ? parseFloat(r.open_volume_ml) : undefined,
        })),
      });
      const { recorded, failed } = resp.data;
      onSaved(`Opening count recorded for ${recorded} product${recorded === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}.`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not save the opening count.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section style={dialog} role="dialog" aria-modal="true" aria-labelledby="opening-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 id="opening-title" style={{ margin: 0, fontSize: 18, color: 'var(--color-text)' }}>Record opening count</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '4px 0 0', maxWidth: 520, lineHeight: 1.5 }}>
              Set where each product stands right now. Enter the number of unopened bottles, and roughly how much is
              left in the open one. Scale readings from here on are measured against this baseline.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>×</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        {loading ? (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, padding: '2rem 0', textAlign: 'center' }}>Loading catalog…</p>
        ) : (
          <>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search products…"
              style={{ ...input, width: '100%', margin: '16px 0 8px' }}
            />

            {missingSpecs > 0 && (
              <div style={{
                fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 8px',
                padding: '8px 10px', borderRadius: 6,
                backgroundColor: '#f0ad4e10', border: '1px solid #f0ad4e30', lineHeight: 1.6,
              }}>
                <strong style={{ color: '#f0ad4e' }}>
                  {missingSpecs} of {rows.length} product{rows.length === 1 ? '' : 's'} can't be counted yet
                </strong>
                {' '}— they have no bottle weight or volume, so a reading against them would record zero.
                {missingSpecs === rows.length && (
                  <> To derive specs for the whole catalog at once, run{' '}
                    <code style={{ fontSize: 11 }}>npm run backfill:specs -- --commit</code>{' '}
                    in <code style={{ fontSize: 11 }}>webapp/smartbar-functions/functions</code>.</>
                )}
                {' '}Otherwise set them per product on the Products page.
              </div>
            )}

            <div style={{ maxHeight: 340, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, backgroundColor: 'var(--color-surface)' }}>
                    <th style={th}></th>
                    <th style={{ ...th, textAlign: 'left' }}>Product</th>
                    <th style={th}>Sealed bottles</th>
                    <th style={th}>Open bottle (ml)</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(r => (
                    <tr key={r.barcode} style={{ borderTop: '1px solid var(--color-border)', opacity: r.hasSpecs ? 1 : 0.5 }}>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          disabled={!r.hasSpecs}
                          checked={r.include}
                          onChange={e => update(r.barcode, { include: e.target.checked })}
                        />
                      </td>
                      <td style={td}>
                        <div>{r.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                          {r.barcode}{!r.hasSpecs && ' · missing specs'}
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <input
                          type="number" min="0" step="1" disabled={!r.hasSpecs || !r.include}
                          value={r.sealed_count}
                          onChange={e => update(r.barcode, { sealed_count: e.target.value })}
                          style={{ ...input, width: 70 }}
                        />
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <input
                          type="number" min="0" step="10" disabled={!r.hasSpecs || !r.include}
                          placeholder="none"
                          value={r.open_volume_ml}
                          onChange={e => update(r.barcode, { open_volume_ml: e.target.value })}
                          style={{ ...input, width: 90 }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {selected.length} product{selected.length === 1 ? '' : 's'} selected
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onClose} style={secondaryBtn}>Cancel</button>
                <button onClick={save} disabled={saving || !selected.length} style={primaryBtn}>
                  {saving ? 'Saving…' : 'Record count'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' };
const dialog: React.CSSProperties = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '1.5rem', width: '100%', maxWidth: 760, maxHeight: '90vh', overflowY: 'auto' };
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 24, color: 'var(--color-text-muted)', cursor: 'pointer', lineHeight: 1 };
const errorBox: React.CSSProperties = { marginTop: 12, padding: '8px 12px', borderRadius: 6, backgroundColor: '#dc354515', border: '1px solid #dc354540', color: '#dc3545', fontSize: 13 };
const input: React.CSSProperties = { padding: '6px 8px', borderRadius: 4, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13 };
const th: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 12, fontWeight: 600 };
const td: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 13 };
const secondaryBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 13 };
const primaryBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: 6, border: '1px solid #007bff', backgroundColor: '#007bff', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 };

export default OpeningCountModal;
