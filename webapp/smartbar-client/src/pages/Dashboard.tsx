import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import OpeningCountModal from '../components/OpeningCountModal';
import AddStockModal from '../components/AddStockModal';

// ─── Formatting helpers ──────────────────────────────────────────────────────
// Every figure on this page comes from real readings or logged events. When an
// input is missing the backend sends null rather than an estimate, so the UI
// must render "—" instead of coercing null to 0 — a fabricated $0 is worse than
// a visible gap.

const currency = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `$${Math.round(Number(value)).toLocaleString()}`;

const currency2 = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `$${Number(value).toFixed(2)}`;

const pct = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;

const litres = (mlValue: number) => `${(Number(mlValue || 0) / 1000).toFixed(1)}L`;

const relativeTime = (iso: string | null) => {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const PERIODS = [7, 14, 30];

const Dashboard = () => {
  const [dashboard, setDashboard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [openingOpen, setOpeningOpen] = useState(false);
  const [addStockOpen, setAddStockOpen] = useState(false);

  const user = useMemo(() => {
    try {
      const raw = localStorage.getItem('user');
      return raw && raw !== 'undefined' ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }, []);
  const isAdmin = user?.role === 'admin' || user?.role === 'platform_admin';

  const load = useCallback(async (period: number) => {
    setError('');
    try {
      const response = await api.get('/dashboard', { params: { days: period } });
      setDashboard(response.data);
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.code === 'NO_BUSINESS') {
        setError('Your account is not linked to a business yet. Ask an administrator to assign one.');
      } else {
        setError(data?.error || err?.message || 'Unable to load the dashboard.');
      }
      setDashboard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { setLoading(true); load(days); }, [days, load]);

  const runAction = async (label: string, fn: () => Promise<any>) => {
    setBusy(label);
    setNotice('');
    try {
      const message = await fn();
      await load(days);
      setNotice(message || 'Done.');
    } catch (err: any) {
      setNotice(err?.response?.data?.error || err?.message || 'That action failed.');
    } finally {
      setBusy('');
    }
  };

  const seedSample = () => runAction('seed', async () => {
    const resp = await api.post('/inventory/seed-sample', { limit: 12, sealed_per_product: 2 });
    return `Seeded ${resp.data.recorded} products as your opening inventory.`;
  });

  const seedShifts = () => runAction('shifts', async () => {
    const resp = await api.post('/shifts/defaults');
    return `Created ${resp.data.length} default shifts.`;
  });

  // ─── Derived view state ────────────────────────────────────────────────────
  const summary = dashboard?.summary || {};
  const products: any[] = dashboard?.products || [];
  const daily: any[] = dashboard?.dailyConsumption || [];
  const weekly: any[] = dashboard?.weeklyTrend || [];
  const categories: any[] = dashboard?.categoryBreakdown || [];
  const shifts: any[] = dashboard?.shifts || [];
  const alerts: any[] = dashboard?.alerts || [];
  const losses: any[] = dashboard?.documentedLosses || [];
  const inbound: any[] = dashboard?.inboundEvents || [];
  const coverage = dashboard?.coverage || {};
  const unexplained: any[] = dashboard?.unexplained || [];

  const maxDaily = Math.max(...daily.map(d => Number(d.consumed_ml) || 0), 1);
  // All three weekly series share one pixel scale, so bars stay comparable.
  const maxWeekly = Math.max(
    ...weekly.flatMap(w => [w.inventory_value, w.consumed_value, w.waste_value].map(v => Number(v) || 0)),
    1,
  );

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading dashboard…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', maxWidth: 700, margin: '0 auto' }}>
        <div style={{ ...card, borderLeft: '4px solid #dc3545' }}>
          <h2 style={{ marginTop: 0, fontSize: 18, color: 'var(--color-text)' }}>Dashboard unavailable</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{error}</p>
          <button style={primaryBtn} onClick={() => { setLoading(true); load(days); }}>Try again</button>
        </div>
      </div>
    );
  }

  const isEmpty = dashboard?.empty || (!products.length && !losses.length);

  return (
    <div style={{ padding: '2rem', maxWidth: 1300, margin: '0 auto' }}>
      {/* ─── Header ─────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ color: 'var(--color-text)', margin: 0 }}>{dashboard?.business?.name || 'Dashboard'}</h1>
        <p style={{ color: 'var(--color-text-muted)', margin: '4px 0 0', fontSize: 14 }}>
          Last {days} days · times shown in {dashboard?.business?.timezone || 'UTC'}
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, marginRight: 8 }}>
            {PERIODS.map(p => (
              <button
                key={p}
                onClick={() => setDays(p)}
                style={{ ...secondaryBtn, ...(days === p ? { borderColor: '#007bff', color: '#007bff' } : {}) }}
              >
                {p}d
              </button>
            ))}
          </div>
          <button style={primaryBtn} onClick={() => setOpeningOpen(true)}>Record opening count</button>
          <button style={secondaryBtn} onClick={() => setAddStockOpen(true)}>Add stock</button>
          {isAdmin && (
            <button style={secondaryBtn} disabled={!!busy} onClick={seedSample}>
              {busy === 'seed' ? 'Seeding…' : 'Seed sample inventory'}
            </button>
          )}
          {notice && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{notice}</span>}
        </div>
      </div>

      {/* ─── Data coverage prompt ───────────────────────────── */}
      {!isEmpty && (coverage.missing_bottle_volume > 0 || coverage.missing_cost_per_bottle > 0 || coverage.missing_pour_price > 0) && (
        <div style={{ ...card, marginBottom: '1.5rem', borderLeft: '4px solid #f0ad4e' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, color: 'var(--color-text)' }}>Some figures can't be calculated yet</h3>
          <ul style={{ margin: '0 0 10px', paddingLeft: 20, color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.7 }}>
            {coverage.missing_bottle_volume > 0 && (
              <li>{coverage.missing_bottle_volume} of {coverage.products_total} products have no bottle volume — on-hand volume and value are excluded for them.</li>
            )}
            {coverage.missing_cost_per_bottle > 0 && (
              <li>{coverage.missing_cost_per_bottle} products have no cost per bottle — inventory value and pour cost are excluded.</li>
            )}
            {coverage.missing_pour_price > 0 && (
              <li>{coverage.missing_pour_price} products have no pour price — revenue and pour cost are excluded.</li>
            )}
          </ul>
          <Link to="/products" style={{ fontSize: 13, color: '#007bff', textDecoration: 'none', fontWeight: 600 }}>
            Set product specs →
          </Link>
        </div>
      )}

      {/* ─── Empty state ────────────────────────────────────── */}
      {isEmpty ? (
        <div style={{ ...card, textAlign: 'center', padding: '3rem 2rem' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20, color: 'var(--color-text)' }}>No inventory data yet</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, maxWidth: 520, margin: '0 auto 20px', lineHeight: 1.6 }}>
            Record an opening count to establish where your stock stands today. Every scale reading after that
            is measured against it, so consumption and pour cost start building immediately.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button style={primaryBtn} onClick={() => setOpeningOpen(true)}>Record opening count</button>
            {isAdmin && (
              <button style={secondaryBtn} disabled={!!busy} onClick={seedSample}>
                {busy === 'seed' ? 'Seeding…' : 'Seed sample inventory'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ─── KPI Cards ───────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
            <KPI label="Inventory On Hand" value={currency(summary.totalOnHand)} sub={`${products.length} products tracked`} color="#007bff" />
            <KPI
              label={`Consumption (${days}d)`}
              value={currency(summary.totalConsumed)}
              sub={`${litres(products.reduce((s, p) => s + Number(p.consumed_ml || 0), 0))} poured`}
              color="#dc3545"
            />
            <KPI
              label={`Documented Loss (${days}d)`}
              value={currency(summary.totalDocumentedLoss)}
              sub={losses.length ? `${losses.reduce((s, l) => s + l.event_count, 0)} logged events` : 'no events logged'}
              color="#f0ad4e"
            />
            <KPI
              label={`Revenue (${days}d)`}
              value={currency(summary.totalRevenue)}
              sub={summary.totalRevenue === null ? 'needs pour prices' : 'from measured pours'}
              color="#28a745"
            />
            <KPI
              label="Avg Pour Cost"
              value={pct(summary.avgPourCost)}
              sub={summary.avgPourCost === null ? 'needs pour prices' : 'target: 18–22%'}
              color={summary.avgPourCost === null ? '#6c757d' : summary.avgPourCost > 22 ? '#dc3545' : '#28a745'}
            />
          </div>

          {/* ─── Alerts ──────────────────────────────────────── */}
          {alerts.length > 0 && (
            <div style={{ ...card, marginBottom: '2rem' }}>
              <h2 style={{ color: 'var(--color-text)', margin: '0 0 16px', fontSize: 18 }}>Alerts</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {alerts.map((a, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', borderRadius: 6,
                    backgroundColor: a.type === 'danger' ? '#dc354510' : a.type === 'warning' ? '#f0ad4e10' : '#007bff10',
                    border: `1px solid ${a.type === 'danger' ? '#dc354530' : a.type === 'warning' ? '#f0ad4e30' : '#007bff30'}`,
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{a.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: 'var(--color-text)', fontSize: 13 }}>{a.message}</div>
                      {a.time && <div style={{ color: 'var(--color-text-muted)', fontSize: 11, marginTop: 2 }}>{relativeTime(a.time)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Charts ──────────────────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
            <div style={card}>
              <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Daily Consumption (ml)</h3>
              {daily.every(d => !d.consumed_ml) ? (
                <Placeholder text="No consumption recorded in this period. A product needs at least two readings before consumption can be measured." />
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, paddingTop: 8 }}>
                    {daily.map(d => (
                      <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{d.consumed_ml || ''}</div>
                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <div style={{ width: '60%', height: (d.consumed_ml / maxDaily) * 150, backgroundColor: '#007bff', borderRadius: '4px 4px 0 0' }} />
                          <div style={{ width: '60%', height: (d.waste_ml / maxDaily) * 150, backgroundColor: '#dc354580', borderRadius: '0 0 4px 4px' }} />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{d.day}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 11 }}>
                    <Legend color="#007bff" label="Consumed" />
                    <Legend color="#dc3545" label="Documented loss" />
                  </div>
                </>
              )}
            </div>

            <div style={card}>
              <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Consumption by Category</h3>
              {!categories.length ? <Placeholder text="No categorised consumption yet." /> : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {categories.map(c => (
                    <div key={c.category}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                        <span style={{ color: 'var(--color-text)' }}>{c.category}</span>
                        <span style={{ color: 'var(--color-text-muted)' }}>{currency2(c.value)} ({c.pct}%)</span>
                      </div>
                      <div style={{ height: 8, borderRadius: 4, backgroundColor: 'var(--color-border)', overflow: 'hidden' }}>
                        <div style={{ width: `${c.pct}%`, height: '100%', backgroundColor: c.color, borderRadius: 4 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ─── Weekly trend ────────────────────────────────── */}
          <div style={{ ...card, marginBottom: '2rem' }}>
            <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Four-Week Trend</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 8px' }}>
              On-hand is the inventory value at the close of each week; consumption and loss are the totals within it.
            </p>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 160, paddingTop: 8 }}>
              {weekly.map(w => (
                <div key={w.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', width: '100%', justifyContent: 'center' }}>
                    <div style={{ width: '25%', height: (w.inventory_value / maxWeekly) * 130, backgroundColor: '#007bff', borderRadius: 4 }} />
                    <div style={{ width: '25%', height: (w.consumed_value / maxWeekly) * 130, backgroundColor: '#dc3545', borderRadius: 4 }} />
                    <div style={{ width: '25%', height: (w.waste_value / maxWeekly) * 130, backgroundColor: '#f0ad4e', borderRadius: 4 }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{w.week}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 11 }}>
              <Legend color="#007bff" label="On hand" />
              <Legend color="#dc3545" label="Consumed" />
              <Legend color="#f0ad4e" label="Documented loss" />
            </div>
          </div>

          {/* ─── Shift analysis ──────────────────────────────── */}
          <div style={{ ...card, marginBottom: '2rem' }}>
            <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Shift Pour Cost</h3>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>
              Consumption attributed to a shift by the time of each reading. Accuracy depends on your shift schedule
              matching who was actually working.
            </p>
            {!shifts.length ? (
              <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 12px' }}>
                  No shifts defined, so consumption can't be attributed to one.
                </p>
                <button style={primaryBtn} disabled={!!busy} onClick={seedShifts}>
                  {busy === 'shifts' ? 'Creating…' : 'Create default shifts'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                {shifts.map(s => (
                  <div key={s._id} style={{
                    padding: '1rem 1.25rem', borderRadius: 8,
                    backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)',
                    borderLeft: `4px solid ${s.color}`,
                  }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
                      {s.window}{s.staff ? ` · ${s.staff}` : ''} · {s.scans} reading{s.scans === 1 ? '' : 's'}
                    </div>
                    {s.pour_cost === null ? (
                      <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                        {s.scans === 0 ? 'No readings in this window.' : 'Pour price needed to calculate pour cost.'}
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{pct(s.pour_cost)}</span>
                          {s.variance !== null && (
                            <span style={{ fontSize: 13, color: s.variance > 0 ? '#dc3545' : '#28a745', fontWeight: 600 }}>
                              {s.variance > 0 ? `+${s.variance}` : s.variance} vs target
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
                          {currency2(s.consumed_value)} poured · {currency2(s.revenue)} revenue
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ─── Product table ───────────────────────────────── */}
          <div style={{ ...card, marginBottom: '2rem' }}>
            <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Product Performance</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                    <th style={th}>Product</th>
                    <th style={th}>Category</th>
                    <th style={th}>On Hand</th>
                    <th style={th}>Consumed</th>
                    <th style={th}>Loss</th>
                    <th style={th}>Pour Cost</th>
                    <th style={th}>Readings</th>
                    <th style={th}>Last Scan</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map(p => (
                    <tr key={p.barcode} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={td}>
                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{p.brand}</div>
                      </td>
                      <td style={td}>
                        <span style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 10,
                          backgroundColor: (categories.find(c => c.category === p.category)?.color || '#999') + '18',
                          color: categories.find(c => c.category === p.category)?.color || '#999',
                        }}>{p.category}</span>
                      </td>
                      <td style={td}>
                        <div>{p.on_hand_ml} ml</div>
                        <div style={{ fontSize: 11, color: '#28a745' }}>{currency2(p.on_hand_value)}</div>
                      </td>
                      <td style={td}>
                        <div>{p.consumed_ml} ml</div>
                        <div style={{ fontSize: 11, color: '#dc3545' }}>{currency2(p.consumed_value)}</div>
                        {p.revenue_value !== null && (
                          <div style={{ fontSize: 10, color: '#28a745' }}>Revenue {currency2(p.revenue_value)}</div>
                        )}
                      </td>
                      <td style={td}>
                        {p.waste_ml > 0
                          ? <span style={{ color: '#dc3545', fontWeight: 600 }}>{p.waste_ml} ml</span>
                          : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                      </td>
                      <td style={td}>
                        {p.pour_cost_pct === null ? (
                          <span title={`Missing: ${p.missing.join(', ')}`} style={{ color: 'var(--color-text-muted)' }}>—</span>
                        ) : (
                          <span style={{ fontWeight: 600, color: p.pour_cost_pct > 25 ? '#dc3545' : p.pour_cost_pct > 22 ? '#f0ad4e' : '#28a745' }}>
                            {pct(p.pour_cost_pct)}
                          </span>
                        )}
                      </td>
                      <td style={td}>{p.scans}</td>
                      <td style={{ ...td, fontSize: 12, color: 'var(--color-text-muted)' }}>{relativeTime(p.last_scan)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Unexplained readings ────────────────────────── */}
          {unexplained.length > 0 && (
            <div style={{ ...card, marginBottom: '2rem', borderLeft: '4px solid #f0ad4e' }}>
              <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Unexplained Readings</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px', lineHeight: 1.6 }}>
                These readings show more liquid disappearing between two scans than a full bottle holds, so they
                can't be pours. They're excluded from consumption and pour cost — counting them would badly distort
                both. Usually a bottle was swapped or the scale was misread, but they're listed because a genuine
                loss would look exactly like this.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                      <th style={th}>Product</th>
                      <th style={th}>Drop</th>
                      <th style={th}>Bottle size</th>
                      <th style={th}>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unexplained.map((u, i) => (
                      <tr key={`${u.barcode}-${i}`} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={td}>{u.product_name}</td>
                        <td style={{ ...td, color: '#f0ad4e', fontWeight: 600 }}>{u.drop_ml} ml</td>
                        <td style={td}>{u.bottle_volume_ml} ml</td>
                        <td style={{ ...td, fontSize: 12, color: 'var(--color-text-muted)' }}>{relativeTime(u.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ─── Documented losses & inbound stock ───────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={card}>
              <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Documented Losses</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>
                Actual breakage, spoilage and comp events logged in this period, valued at cost.
              </p>
              {!losses.length ? (
                <Placeholder text="No loss events logged in this period. Log breakage and comps from the Inventory page to track them here." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {losses.map(row => (
                    <div key={row.type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--color-text)', fontSize: 13 }}>
                        {row.label}
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}> · {row.event_count} event{row.event_count === 1 ? '' : 's'}</span>
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 14, color: row.color }}>{currency2(row.value)}</span>
                    </div>
                  ))}
                  <div style={{ borderTop: '2px solid var(--color-border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-text)' }}>Total documented loss</span>
                    <span style={{ fontWeight: 700, fontSize: 20, color: '#dc3545' }}>{currency2(summary.totalDocumentedLoss)}</span>
                  </div>
                </div>
              )}
            </div>

            <div style={card}>
              <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Stock Received</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>
                Deliveries and transfers in during this period, valued at cost.
              </p>
              {!inbound.length ? (
                <Placeholder text="No deliveries logged in this period." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {inbound.map(row => (
                    <div key={row.type} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--color-text)', fontSize: 13 }}>
                        {row.label}
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}> · {row.event_count} event{row.event_count === 1 ? '' : 's'}</span>
                      </span>
                      <span style={{ fontWeight: 600, fontSize: 14, color: '#28a745' }}>{currency2(row.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {openingOpen && (
        <OpeningCountModal
          onClose={() => setOpeningOpen(false)}
          onSaved={(message: string) => { setOpeningOpen(false); setNotice(message); load(days); }}
        />
      )}
      {addStockOpen && (
        <AddStockModal
          products={products}
          onClose={() => setAddStockOpen(false)}
          onSaved={(message: string) => { setAddStockOpen(false); setNotice(message); load(days); }}
        />
      )}
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const KPI = ({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) => (
  <div style={{ padding: '1rem 1.25rem', borderRadius: 8, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: `4px solid ${color}` }}>
    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text)' }}>{value}</div>
    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</div>
  </div>
);

const Legend = ({ color, label }: { color: string; label: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
    <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
    <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
  </div>
);

const Placeholder = ({ text }: { text: string }) => (
  <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '1rem 0', lineHeight: 1.6 }}>{text}</p>
);

const card: React.CSSProperties = { padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' };
const th: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 12, fontWeight: 600 };
const td: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 13 };
const secondaryBtn: React.CSSProperties = { padding: '7px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 12 };
const primaryBtn: React.CSSProperties = { padding: '7px 14px', borderRadius: 6, border: '1px solid #007bff', backgroundColor: '#007bff', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 };

export default Dashboard;
