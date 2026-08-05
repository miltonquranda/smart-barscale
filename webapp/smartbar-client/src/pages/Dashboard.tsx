import React, { useEffect, useState } from 'react';
import api from '../api';

// ─── Component ───────────────────────────────────────────────────────────────

const Dashboard = () => {
  const [, setUser] = useState<any>({});
  const [dashboard, setDashboard] = useState<any>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMessage, setDemoMessage] = useState('');
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const [scenarioForm, setScenarioForm] = useState({ product_id: '', scale_weight_g: '', sealed_count: '0', expected_consumed_ml: '260', added_bottles: '0' });

  const loadDashboard = async () => {
    // Dashboard data is intentionally live. Add a cache key so a previously
    // empty GET response cannot be reused by the browser/hosting edge after
    // the seed operation has completed.
    const response = await api.get('/demo/dashboard', {
      params: { _ts: Date.now() },
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.data || !response.data.summary) {
      throw new Error('Dashboard response was missing summary data');
    }
    setDashboard(response.data);
    return response.data;
  };

  const runDemoAction = async (action: 'seed' | 'reset' | 'simulate', scenarioOverrides?: typeof scenarioForm) => {
    setDemoBusy(true);
    setDemoMessage('');
    try {
      if (action === 'reset') await api.post('/demo/reset');
      else if (action === 'seed') await api.post('/demo/seed');
      else await api.post('/demo/simulate', {
        scenario: 'busy_friday',
        ...scenarioOverrides,
        scale_weight_g: Number(scenarioOverrides?.scale_weight_g),
        expected_consumed_ml: Number(scenarioOverrides?.expected_consumed_ml),
        sealed_count: Number(scenarioOverrides?.sealed_count),
        added_bottles: Number(scenarioOverrides?.added_bottles),
      });
      await loadDashboard();
      setDemoMessage(action === 'simulate' ? 'Busy Friday scenario applied.' : action === 'seed' ? 'Demo Bar seeded.' : 'Demo data reset.');
      if (action === 'simulate') setScenarioOpen(false);
    } catch (err: any) {
      const status = err?.response?.status ? ` (${err.response.status})` : '';
      const detail = err?.response?.data?.error || err?.message;
      setDemoMessage(`${detail || 'Demo action failed.'}${status}`);
    } finally {
      setDemoBusy(false);
    }
  };

  const openScenario = () => {
    const firstProduct = products[0];
    const previousSealed = Number(firstProduct?.sealed_count ?? Math.floor(Number(firstProduct?.on_hand_ml || 0) / Number(firstProduct?.volume_ml || 750)));
    setScenarioForm({
      product_id: firstProduct?._id || '',
      scale_weight_g: String(Math.max(200, Number(firstProduct?.scale_weight_g || 200 + Math.min(Number(firstProduct?.on_hand_ml || 0), Number(firstProduct?.volume_ml || 750))) - 305)),
      sealed_count: String(previousSealed),
      expected_consumed_ml: '260',
      added_bottles: '0',
    });
    setScenarioOpen(true);
  };

  useEffect(() => {
    try {
      const storedUser = localStorage.getItem('user');
      if (storedUser && storedUser !== 'undefined') setUser(JSON.parse(storedUser));
    } catch (_) {}
    loadDashboard().catch((err: any) => {
      const status = err?.response?.status ? ` (${err.response.status})` : '';
      setDemoMessage(`Unable to load dashboard${status}: ${err?.response?.data?.error || err?.message || 'check your connection'}`);
    });
  }, []);

  const products: any[] = dashboard?.products || [];
  const daily: any[] = dashboard?.dailyConsumption || [];
  const weekly: any[] = dashboard?.weeklyTrend || [];
  const categories: any[] = dashboard?.categoryBreakdown || [];
  const dashboardAlerts: any[] = dashboard?.alerts || [];
  const dashboardShifts: any[] = dashboard?.shifts || [];
  const summary = dashboard?.summary || {
    totalOnHand: 0,
    totalConsumed: 0,
    totalWaste: 0,
    totalRevenue: 0,
    avgPourCost: 0,
  };

  const maxDailyConsumed = Math.max(...daily.map(d => d.consumed_ml), 1);
  // All three weekly series share one pixel scale. Using only inventory as
  // the maximum makes consumption/waste bars overflow the chart when their
  // dollar totals are larger than the value of stock on hand.
  const maxWeeklyValue = Math.max(
    ...weekly.flatMap(w => [Number(w.inventory_value) || 0, Number(w.consumed_value) || 0, Number(w.waste_value) || 0]),
    1,
  );

  const currency = (value: number) => `$${Math.round(Number(value) || 0).toLocaleString()}`;
  const annualWaste = summary.totalWaste * 52;
  const lossRows = [
    { label: 'Over-pour reduction (5% improvement)', value: summary.totalConsumed * 0.05 * 52 },
    { label: 'Waste reduction (60% of observed loss)', value: annualWaste * 0.6 },
    { label: 'Optimized ordering (10% of on-hand)', value: summary.totalOnHand * 0.1 * 12 },
    { label: 'Comp tracking accuracy (15% of waste)', value: annualWaste * 0.15 },
  ];
  const taxRows = [
    { label: 'Documented breakage (current period)', value: summary.totalWaste * 0.45, color: '#dc3545' },
    { label: 'Documented spoilage (current period)', value: summary.totalWaste * 0.15, color: '#dc3545' },
    { label: 'Documented theft / anomalies (current period)', value: summary.totalWaste * 0.25, color: '#dc3545' },
    { label: 'Comps & giveaways (current period)', value: summary.totalWaste * 0.15, color: '#f0ad4e' },
  ];
  const totalTaxDeduction = taxRows.reduce((sum, row) => sum + row.value, 0);
  const annualSavings = lossRows.reduce((sum, row) => sum + row.value, 0);
  const highestPourCost = [...products].sort((a, b) => Number(b.pour_cost_pct) - Number(a.pour_cost_pct))[0];
  const highestWaste = [...products].sort((a, b) => Number(b.waste_ml) - Number(a.waste_ml))[0];
  const lowestStock = [...products].sort((a, b) => Number(a.on_hand_ml) - Number(b.on_hand_ml))[0];
  const recommendations = [
    highestPourCost && {
      title: `Review ${highestPourCost.name} pours`, priority: Number(highestPourCost.pour_cost_pct) > 25 ? 'high' : 'medium',
      desc: `Pour cost is ${highestPourCost.pour_cost_pct}% on ${highestPourCost.scans_today} scans. Compare measured pours with the target range.`,
      impact: `Reduce an estimated ${currency(Number(highestPourCost.consumed_value) * 0.05)}/week`,
    },
    highestWaste && {
      title: `Investigate ${highestWaste.name} waste`, priority: Number(highestWaste.waste_ml) > 100 ? 'high' : 'medium',
      desc: `${highestWaste.waste_ml}ml of waste has been recorded. Confirm breakage and comp events at the next count.`,
      impact: `Recover up to ${currency(Number(highestWaste.waste_value))}`,
    },
    lowestStock && {
      title: `Reorder ${lowestStock.name}`, priority: 'medium',
      desc: `Only ${lowestStock.on_hand_ml}ml remains on hand. Review recent consumption before the next delivery window.`,
      impact: 'Prevent a potential stock-out',
    },
    {
      title: 'Tighten count follow-up', priority: 'low',
      desc: `${products.length} products are tracked. Schedule a follow-up count for items with recent waste or abnormal pour cost.`,
      impact: `Protect ${currency(summary.totalWaste)}/current-period loss`,
    },
  ].filter(Boolean) as any[];

  return (
    <div style={{ padding: '2rem', maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ color: 'var(--color-text)', margin: 0 }}>Dashboard</h1>
        <p style={{ color: 'var(--color-text-muted)', margin: '4px 0 0', fontSize: 14 }}>
          {dashboard?.business?.name || 'Demo Bar'} · live inventory intelligence
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <button onClick={() => runDemoAction('seed')} disabled={demoBusy} style={demoButton}>Seed Demo Bar</button>
          <button onClick={openScenario} disabled={demoBusy || !dashboard} style={demoButton}>Run Busy Friday</button>
          <button onClick={() => runDemoAction('reset')} disabled={demoBusy} style={{ ...demoButton, color: '#dc3545' }}>Reset Demo</button>
          {demoMessage && <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{demoMessage}</span>}
        </div>
      </div>

      {scenarioOpen && <div className="scenario-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setScenarioOpen(false); }}>
        <section className="scenario-dialog" role="dialog" aria-modal="true" aria-labelledby="scenario-title">
          <div className="scenario-dialog-header"><div><span className="eyebrow">DEMO EVENT PREVIEW</span><h2 id="scenario-title">Busy Friday simulation</h2></div><button className="scenario-close" onClick={() => setScenarioOpen(false)} aria-label="Close">×</button></div>
          <p className="scenario-copy">This writes one inventory event, just like a bottle scan. Review or change the values before applying it.</p>
          <div className="scenario-form">
            <label>Product<select value={scenarioForm.product_id} onChange={event => { const next = products.find(item => item._id === event.target.value); const currentWeight = Number(next?.scale_weight_g || 200 + Math.min(Number(next?.on_hand_ml || 0), Number(next?.volume_ml || 750))); const nextSealed = Number(next?.sealed_count ?? Math.floor(Number(next?.on_hand_ml || 0) / Number(next?.volume_ml || 750))); setScenarioForm({ ...scenarioForm, product_id: event.target.value, scale_weight_g: String(Math.max(200, currentWeight - 305)), sealed_count: String(nextSealed) }); }}>{products.map(product => <option key={product._id} value={product._id}>{product.name}</option>)}</select></label>
            <label>New scale weight (g)<input type="number" min="0" step="1" value={scenarioForm.scale_weight_g} onChange={event => setScenarioForm({ ...scenarioForm, scale_weight_g: event.target.value })} /></label>
            <label>New sealed bottle count<input type="number" min="0" step="1" value={scenarioForm.sealed_count} onChange={event => setScenarioForm({ ...scenarioForm, sealed_count: event.target.value })} /></label>
            <label>Expected consumption (ml)<input type="number" min="0" step="10" value={scenarioForm.expected_consumed_ml} onChange={event => setScenarioForm({ ...scenarioForm, expected_consumed_ml: event.target.value })} /></label>
            <label>New bottles added<input type="number" min="0" step="1" value={scenarioForm.added_bottles} onChange={event => setScenarioForm({ ...scenarioForm, added_bottles: event.target.value })} /></label>
          </div>
          {(() => {
            const product = products.find(item => item._id === scenarioForm.product_id);
            const volume = Number(product?.volume_ml || 750);
            const previousSealed = Number(product?.sealed_count ?? Math.floor(Number(product?.on_hand_ml || 0) / volume));
            const previousOpen = Number(product?.open_volume_ml ?? Math.max(0, Number(product?.on_hand_ml || 0) - previousSealed * volume));
            const previousWeight = Number(product?.scale_weight_g || 200 + previousOpen);
            const currentOpen = Math.min(volume, Math.max(0, Number(scenarioForm.scale_weight_g || 0) - Number(product?.bottle_empty_weight_g || 200)));
            const previousTotal = previousOpen + previousSealed * volume;
            const currentTotal = currentOpen + Number(scenarioForm.sealed_count || 0) * volume;
            const measuredLoss = Math.round(previousTotal + Number(scenarioForm.added_bottles || 0) * volume - currentTotal);
            const calculatedConsumed = Math.max(0, measuredLoss);
            const calculatedWaste = Math.max(0, Math.round(calculatedConsumed - Number(scenarioForm.expected_consumed_ml || 0)));
            return <div className="scenario-impact"><strong>Calculated from inventory state + scale</strong><span>Previous: {Math.round(previousTotal)}ml ({previousWeight}g)</span><span>Current: {Math.round(currentTotal)}ml</span><span>Consumed: {calculatedConsumed}ml</span><span>Waste: {calculatedWaste}ml</span><span>{scenarioForm.added_bottles || 0} bottle addition</span></div>;
          })()}
          <div className="scenario-actions"><button className="scenario-cancel" onClick={() => setScenarioOpen(false)}>Cancel</button><button className="primary-action" disabled={demoBusy || !scenarioForm.product_id} onClick={() => runDemoAction('simulate', scenarioForm)}>{demoBusy ? 'Applying…' : 'Apply event'}</button></div>
        </section>
      </div>}

      {/* ─── KPI Cards ────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(195px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <KPI label="Inventory On Hand" value={`$${summary.totalOnHand.toFixed(0)}`} sub={`${products.length} products`} color="#007bff" trend={null} />
        <KPI label="Weekly Consumption" value={`$${summary.totalConsumed.toFixed(0)}`} sub={`${(products.reduce((s, p) => s + p.consumed_ml, 0) / 1000).toFixed(1)}L total`} color="#dc3545" trend="+8.3%" />
        <KPI label="Weekly Waste" value={`$${summary.totalWaste.toFixed(0)}`} sub="breakage + comps" color="#f0ad4e" trend="-12.1%" trendGood />
        <KPI label="Revenue (Est.)" value={`$${summary.totalRevenue.toFixed(0)}`} sub="based on POS data" color="#28a745" trend="+5.7%" />
        <KPI label="Avg Pour Cost" value={`${summary.avgPourCost.toFixed(1)}%`} sub="target: 18–22%" color={summary.avgPourCost > 22 ? '#dc3545' : '#28a745'} trend={summary.avgPourCost > 22 ? 'Above target' : 'On target'} trendGood={summary.avgPourCost <= 22} />
        <KPI label="Potential Savings" value={`$${Math.round(summary.totalWaste * 0.6)}/wk`} sub="with loss prevention" color="#6f42c1" trend={null} />
      </div>

      {/* ─── AI Alerts ────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ color: 'var(--color-text)', margin: 0, fontSize: 18 }}>AI Alerts & Insights</h2>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Powered by SmartBar AI</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {dashboardAlerts.map((a, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', borderRadius: 6,
              backgroundColor: a.type === 'danger' ? '#dc354510' : a.type === 'warning' ? '#f0ad4e10' : a.type === 'success' ? '#28a74510' : '#007bff10',
              border: `1px solid ${a.type === 'danger' ? '#dc354530' : a.type === 'warning' ? '#f0ad4e30' : a.type === 'success' ? '#28a74530' : '#007bff30'}`,
            }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{a.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--color-text)', fontSize: 13 }}>{a.message}</div>
                <div style={{ color: 'var(--color-text-muted)', fontSize: 11, marginTop: 2 }}>{a.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Charts Row ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        {/* Daily Consumption Bar Chart */}
        <div style={card}>
          <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Daily Consumption (ml)</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 180, paddingTop: 8 }}>
            {daily.map((d, i) => {
              const h = (d.consumed_ml / maxDailyConsumed) * 150;
              const wh = (d.waste_ml / maxDailyConsumed) * 150;
              const isWeekend = i >= 5;
              return (
                <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{d.consumed_ml}</div>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <div style={{ width: '60%', height: h, backgroundColor: isWeekend ? '#007bff' : '#007bff99', borderRadius: '4px 4px 0 0', transition: 'height 0.3s' }} />
                    <div style={{ width: '60%', height: wh, backgroundColor: '#dc354580', borderRadius: '0 0 4px 4px' }} />
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: isWeekend ? 700 : 400 }}>{d.day}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 11 }}>
            <Legend color="#007bff" label="Consumed" />
            <Legend color="#dc3545" label="Waste" />
          </div>
        </div>

        {/* Category Donut */}
        <div style={card}>
          <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>By Category</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {categories.map(c => (
              <div key={c.category}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: 'var(--color-text)' }}>{c.category}</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>${c.value} ({c.pct}%)</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, backgroundColor: 'var(--color-border)', overflow: 'hidden' }}>
                  <div style={{ width: `${c.pct}%`, height: '100%', backgroundColor: c.color, borderRadius: 4, transition: 'width 0.5s' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Weekly Trend ─────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: '2rem' }}>
        <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Weekly Trend — Inventory vs. Consumption</h3>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 160, paddingTop: 8 }}>
          {weekly.map(w => {
            const invH = (w.inventory_value / maxWeeklyValue) * 130;
            const conH = (w.consumed_value / maxWeeklyValue) * 130;
            const wasH = (w.waste_value / maxWeeklyValue) * 130;
            return (
              <div key={w.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', width: '100%', justifyContent: 'center' }}>
                  <div style={{ width: '25%', height: invH, backgroundColor: '#007bff', borderRadius: 4 }} />
                  <div style={{ width: '25%', height: conH, backgroundColor: '#dc3545', borderRadius: 4 }} />
                  <div style={{ width: '25%', height: wasH, backgroundColor: '#f0ad4e', borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{w.week}</div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 11 }}>
          <Legend color="#007bff" label="On Hand" />
          <Legend color="#dc3545" label="Consumed" />
          <Legend color="#f0ad4e" label="Waste" />
        </div>
      </div>

      {/* ─── Shift Analysis ───────────────────────────────────── */}
      <div style={{ ...card, marginBottom: '2rem' }}>
        <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Shift Pour Cost Analysis</h3>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>
          Target range: 18–22% · AI identifies shifts with abnormal pour costs
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {dashboardShifts.map(s => (
            <div key={s.name} style={{
              padding: '1rem 1.25rem', borderRadius: 8,
              backgroundColor: 'var(--color-bg)', border: `1px solid var(--color-border)`,
              borderLeft: `4px solid ${s.color}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>{s.bartender} · {s.scans} scans</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.pour_cost}%</span>
                <span style={{ fontSize: 13, color: s.variance > 0 ? '#dc3545' : '#28a745', fontWeight: 600 }}>
                  {s.variance > 0 ? `+${s.variance}%` : `${s.variance}%`} vs target
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 3, backgroundColor: 'var(--color-border)', marginTop: 10, position: 'relative', overflow: 'visible' }}>
                <div style={{ width: `${Math.min(s.pour_cost / 35 * 100, 100)}%`, height: '100%', backgroundColor: s.color, borderRadius: 3 }} />
                {/* Target marker */}
                <div style={{ position: 'absolute', left: `${19 / 35 * 100}%`, top: -3, width: 2, height: 12, backgroundColor: 'var(--color-text-muted)', borderRadius: 1 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                <span>0%</span><span>Target (19%)</span><span>35%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Top Products Table ───────────────────────────────── */}
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
                <th style={th}>Waste</th>
                <th style={th}>Pour Cost</th>
                <th style={th}>Scans</th>
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
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: (categories.find(c => c.category === p.category)?.color || '#999') + '18', color: categories.find(c => c.category === p.category)?.color || '#999' }}>
                      {p.category}
                    </span>
                  </td>
                  <td style={td}>
                    <div>{p.on_hand_ml} ml</div>
                    <div style={{ fontSize: 11, color: '#28a745' }}>${p.on_hand_value.toFixed(2)}</div>
                  </td>
                  <td style={td}>
                    <div>{p.consumed_ml} ml</div>
                    <div style={{ fontSize: 11, color: '#dc3545' }}>${p.consumed_value.toFixed(2)}</div>
                    {Number(p.revenue_value) > 0 && <div style={{ fontSize: 10, color: '#28a745' }}>Sales ${Number(p.revenue_value).toFixed(2)}</div>}
                  </td>
                  <td style={td}>
                    {p.waste_ml > 50 ? (
                      <span style={{ color: '#dc3545', fontWeight: 600 }}>{p.waste_ml} ml</span>
                    ) : (
                      <span>{p.waste_ml} ml</span>
                    )}
                  </td>
                  <td style={td}>
                    <span style={{
                      fontWeight: 600,
                      color: p.pour_cost_pct > 25 ? '#dc3545' : p.pour_cost_pct > 22 ? '#f0ad4e' : '#28a745',
                    }}>
                      {p.pour_cost_pct}%
                    </span>
                  </td>
                  <td style={td}>{p.scans_today}</td>
                  <td style={{ ...td, fontSize: 12, color: 'var(--color-text-muted)' }}>{p.last_scan}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Financial Summary ────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
        <div style={card}>
          <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Loss Prevention Opportunity</h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>
            Projected annual savings based on current waste patterns
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {lossRows.map(row => <FinRow key={row.label} label={row.label} value={currency(row.value)} color="#28a745" />)}
            <div style={{ borderTop: '2px solid var(--color-border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-text)' }}>Estimated Annual Savings</span>
              <span style={{ fontWeight: 700, fontSize: 20, color: '#28a745' }}>{currency(annualSavings)}</span>
            </div>
          </div>
        </div>

        <div style={card}>
          <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>Tax Deduction Potential</h3>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 16px' }}>
            Documented losses eligible for year-end deductions
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {taxRows.map(row => <FinRow key={row.label} label={row.label} value={currency(row.value)} color={row.color} />)}
            <div style={{ borderTop: '2px solid var(--color-border)', paddingTop: 12, display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-text)' }}>Total Deductible Losses</span>
              <span style={{ fontWeight: 700, fontSize: 20, color: '#dc3545' }}>{currency(totalTaxDeduction)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── AI Recommendations ───────────────────────────────── */}
      <div style={card}>
        <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 16 }}>AI Recommendations</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem', marginTop: 8 }}>
          {recommendations.map((recommendation, index) => <Rec key={`${recommendation.title}-${index}`} {...recommendation} />)}
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--color-text-muted)', fontSize: 12 }}>
        Demo controls write real events to the Demo Bar data model; production dashboards can use the same API shape.
      </div>
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

const KPI = ({ label, value, sub, color, trend, trendGood }: { label: string; value: string; sub: string; color: string; trend: string | null; trendGood?: boolean }) => (
  <div style={{ padding: '1rem 1.25rem', borderRadius: 8, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: `4px solid ${color}` }}>
    <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text)' }}>{value}</span>
      {trend && <span style={{ fontSize: 11, fontWeight: 600, color: trendGood ? '#28a745' : trend.startsWith('-') ? '#28a745' : '#dc3545' }}>{trend}</span>}
    </div>
    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>{sub}</div>
  </div>
);

const Legend = ({ color, label }: { color: string; label: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
    <div style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
    <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
  </div>
);

const FinRow = ({ label, value, color }: { label: string; value: string; color: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span style={{ color: 'var(--color-text)', fontSize: 13 }}>{label}</span>
    <span style={{ fontWeight: 600, fontSize: 14, color }}>{value}</span>
  </div>
);

const Rec = ({ title, desc, impact, priority }: { title: string; desc: string; impact: string; priority: string }) => {
  const prioColor = priority === 'high' ? '#dc3545' : priority === 'medium' ? '#f0ad4e' : '#28a745';
  return (
    <div style={{ padding: '1rem 1.25rem', borderRadius: 8, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)' }}>{title}</span>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, backgroundColor: prioColor + '20', color: prioColor, fontWeight: 600 }}>{priority}</span>
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0 0 8px', lineHeight: 1.5 }}>{desc}</p>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#28a745' }}>{impact}</div>
    </div>
  );
};

const card: React.CSSProperties = { padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' };
const th: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 12, fontWeight: 600 };
const td: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 13 };
const demoButton: React.CSSProperties = { padding: '7px 12px', borderRadius: 6, border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 12 };

export default Dashboard;
