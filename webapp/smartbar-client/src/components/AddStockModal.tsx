import React, { useEffect, useState } from 'react';
import api from '../api';

/**
 * Add stock: logs a delivery and raises the sealed-bottle count immediately.
 *
 * Without this, a delivery looks like a mystery inventory increase, and the
 * dashboard has to guess whether stock went up because bottles arrived or
 * because someone put a fresh bottle on the scale. Logging it explicitly keeps
 * consumption honest — the delivery is recorded as a gain, not as negative
 * consumption.
 */
const AddStockModal = ({ products, onClose, onSaved }: {
  products: any[];
  onClose: () => void;
  onSaved: (m: string) => void;
}) => {
  const [catalog, setCatalog] = useState<any[]>([]);
  const [barcode, setBarcode] = useState('');
  const [bottles, setBottles] = useState('1');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Products already on the dashboard are the likely case; fall back to the
  // full catalog so a first-time delivery of something new can be logged too.
  useEffect(() => {
    if (products.length) {
      setCatalog(products.map(p => ({ barcode: p.barcode, name: p.name })));
      setBarcode(products[0].barcode);
      return;
    }
    api.get('/bottles')
      .then(resp => {
        const list = (resp.data || [])
          .filter((b: any) => b.barcode)
          .map((b: any) => ({ barcode: b.barcode, name: b.name || 'Unnamed product' }));
        setCatalog(list);
        if (list.length) setBarcode(list[0].barcode);
      })
      .catch(() => setError('Could not load the product list.'));
  }, [products]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const resp = await api.post('/inventory/add-stock', {
        barcode,
        bottles: parseInt(bottles) || 0,
        notes,
        date,
      });
      const name = catalog.find(c => c.barcode === barcode)?.name || barcode;
      onSaved(`Added ${bottles} bottle(s) of ${name}. Sealed count is now ${resp.data.sealed_count}.`);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Could not add stock.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={backdrop} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section style={dialog} role="dialog" aria-modal="true" aria-labelledby="stock-title">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 id="stock-title" style={{ margin: 0, fontSize: 18, color: 'var(--color-text)' }}>Add stock</h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '4px 0 0', lineHeight: 1.5 }}>
              Logs a delivery and raises the sealed bottle count, so the increase isn't mistaken for a
              measurement error.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>×</button>
        </div>

        {error && <div style={errorBox}>{error}</div>}

        <form onSubmit={save} style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={label}>
            Product
            <select value={barcode} onChange={e => setBarcode(e.target.value)} required style={input}>
              {!catalog.length && <option value="">No products available</option>}
              {catalog.map(c => <option key={c.barcode} value={c.barcode}>{c.name}</option>)}
            </select>
          </label>

          <label style={label}>
            Bottles received
            <input type="number" min="1" step="1" value={bottles} required
              onChange={e => setBottles(e.target.value)} style={input} />
          </label>

          <label style={label}>
            Date
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} />
          </label>

          <label style={label}>
            Notes (optional)
            <input type="text" value={notes} placeholder="Invoice number, supplier…"
              onChange={e => setNotes(e.target.value)} style={input} />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={onClose} style={secondaryBtn}>Cancel</button>
            <button type="submit" disabled={saving || !barcode} style={primaryBtn}>
              {saving ? 'Saving…' : 'Add stock'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};

const backdrop: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' };
const dialog: React.CSSProperties = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: '1.5rem', width: '100%', maxWidth: 460 };
const closeBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 24, color: 'var(--color-text-muted)', cursor: 'pointer', lineHeight: 1 };
const errorBox: React.CSSProperties = { marginTop: 12, padding: '8px 12px', borderRadius: 6, backgroundColor: '#dc354515', border: '1px solid #dc354540', color: '#dc3545', fontSize: 13 };
const label: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: 'var(--color-text)' };
const input: React.CSSProperties = { padding: '8px 10px', borderRadius: 4, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)', fontSize: 13 };
const secondaryBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 13 };
const primaryBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: 6, border: '1px solid #007bff', backgroundColor: '#007bff', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 };

export default AddStockModal;
