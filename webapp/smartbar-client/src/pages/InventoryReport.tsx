import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';

const InventoryReport = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [report, setReport] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get(`/inventory/report/${id}`)
            .then(r => setReport(r.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>;
    if (!report) return <div style={{ padding: '2rem', color: 'var(--color-text)' }}>Report not found.</div>;

    const items: any[] = report.items || [];
    const topConsumed = [...items].filter(i => i.consumed_value > 0)
        .sort((a, b) => b.consumed_value - a.consumed_value).slice(0, 10);

    return (
        <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
            <button onClick={() => navigate('/inventory')}
                style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', padding: 0, fontSize: 14, marginBottom: 8 }}>
                ← Back to Inventory
            </button>
            <h1 style={{ color: 'var(--color-text)', margin: '0 0 0.25rem' }}>Consumption Report</h1>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontSize: 14 }}>
                {report.start_date} → {report.end_date} &nbsp;·&nbsp; {report.products_tracked} products
            </p>

            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                <SummaryCard label="Start Value" value={`$${report.total_start_value?.toFixed(2)}`} color="#007bff" />
                <SummaryCard label="Deliveries" value={`$${report.total_deliveries_value?.toFixed(2)}`} color="#28a745" />
                <SummaryCard label="End Value" value={`$${report.total_end_value?.toFixed(2)}`} color="#6c757d" />
                <SummaryCard label="Consumed" value={`$${report.total_consumed_value?.toFixed(2)}`} color="#dc3545" />
                <SummaryCard label="Waste / Comps" value={`$${report.total_waste_value?.toFixed(2)}`} color="#f0ad4e" />
            </div>

            {/* Flow Bar */}
            {report.total_start_value > 0 && (
                <div style={{ ...cardStyle, marginBottom: '2rem' }}>
                    <h3 style={{ color: 'var(--color-text)', marginTop: 0, marginBottom: 16 }}>Inventory Flow</h3>
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                            Available: ${(report.total_start_value + report.total_deliveries_value).toFixed(2)}
                        </div>
                        <div style={{ height: 28, borderRadius: 6, overflow: 'hidden', display: 'flex', backgroundColor: 'var(--color-border)' }}>
                            {(() => {
                                const total = report.total_start_value + report.total_deliveries_value;
                                if (total <= 0) return null;
                                const remainPct = (report.total_end_value / total) * 100;
                                const consumedPct = (report.total_consumed_value / total) * 100;
                                const wastePct = (report.total_waste_value / total) * 100;
                                return (<>
                                    <div style={{ width: `${remainPct}%`, backgroundColor: '#007bff' }} />
                                    <div style={{ width: `${consumedPct}%`, backgroundColor: '#dc3545' }} />
                                    <div style={{ width: `${wastePct}%`, backgroundColor: '#f0ad4e' }} />
                                </>);
                            })()}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
                        <Legend color="#007bff" label="Remaining" />
                        <Legend color="#dc3545" label="Consumed" />
                        <Legend color="#f0ad4e" label="Waste / Comps" />
                    </div>
                </div>
            )}

            {/* Top Consumed */}
            {topConsumed.length > 0 && (
                <div style={{ ...cardStyle, marginBottom: '2rem' }}>
                    <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Top Consumed</h3>
                    {topConsumed.map((item, idx) => {
                        const maxVal = topConsumed[0].consumed_value || 1;
                        const pct = (item.consumed_value / maxVal) * 100;
                        return (
                            <div key={item.barcode} style={{ marginBottom: 10 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                                    <span style={{ color: 'var(--color-text)' }}>
                                        {idx + 1}. {item.product_name || item.barcode}
                                        {item.product_brand && <span style={{ color: 'var(--color-text-muted)' }}> — {item.product_brand}</span>}
                                    </span>
                                    <span style={{ fontWeight: 600, color: '#dc3545' }}>${item.consumed_value.toFixed(2)}</span>
                                </div>
                                <div style={{ height: 8, borderRadius: 4, backgroundColor: 'var(--color-border)', overflow: 'hidden' }}>
                                    <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#dc354580', borderRadius: 4 }} />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Detail Table */}
            <div style={cardStyle}>
                <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Detailed Breakdown</h3>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                                <th style={thStyle}>Product</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}>Start (ml)</th>
                                <th style={thStyle}>Deliveries</th>
                                <th style={thStyle}>Breakage</th>
                                <th style={thStyle}>Comps</th>
                                <th style={thStyle}>End (ml)</th>
                                <th style={thStyle}>Consumed (ml)</th>
                                <th style={thStyle}>Consumed ($)</th>
                                <th style={thStyle}>Scans</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item: any) => (
                                <tr key={item.barcode} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={tdStyle}>
                                        <div>{item.product_name || item.barcode}</div>
                                        {item.product_brand && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{item.product_brand}</div>}
                                    </td>
                                    <td style={tdStyle}>
                                        <span style={{
                                            fontSize: 11, padding: '2px 8px', borderRadius: 10,
                                            backgroundColor: item.status === 'new' ? '#007bff22' : '#28a74522',
                                            color: item.status === 'new' ? '#007bff' : '#28a745',
                                        }}>{item.status}</span>
                                    </td>
                                    <td style={tdStyle}>{item.start_volume_ml || '—'}</td>
                                    <td style={tdStyle}>{item.deliveries_volume_ml || '—'}</td>
                                    <td style={tdStyle}>{item.breakage_volume_ml ? <span style={{ color: '#dc3545' }}>−{item.breakage_volume_ml}</span> : '—'}</td>
                                    <td style={tdStyle}>{item.comps_volume_ml ? <span style={{ color: '#f0ad4e' }}>−{item.comps_volume_ml}</span> : '—'}</td>
                                    <td style={tdStyle}>{item.end_volume_ml || '—'}</td>
                                    <td style={{ ...tdStyle, fontWeight: 600 }}>{item.consumed_volume_ml || '—'}</td>
                                    <td style={{ ...tdStyle, fontWeight: 600, color: '#dc3545' }}>
                                        {item.consumed_value > 0 ? `$${item.consumed_value.toFixed(2)}` : '—'}
                                    </td>
                                    <td style={tdStyle}>{item.reading_count || 0}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 700 }}>
                                <td style={tdStyle}>TOTALS</td>
                                <td style={tdStyle}></td>
                                <td style={tdStyle}>{items.reduce((s: number, i: any) => s + (i.start_volume_ml || 0), 0) || '—'}</td>
                                <td style={tdStyle}>{items.reduce((s: number, i: any) => s + (i.deliveries_volume_ml || 0), 0) || '—'}</td>
                                <td style={tdStyle}>{items.reduce((s: number, i: any) => s + (i.breakage_volume_ml || 0), 0) ? <span style={{ color: '#dc3545' }}>−{items.reduce((s: number, i: any) => s + (i.breakage_volume_ml || 0), 0)}</span> : '—'}</td>
                                <td style={tdStyle}>{items.reduce((s: number, i: any) => s + (i.comps_volume_ml || 0), 0) ? <span style={{ color: '#f0ad4e' }}>−{items.reduce((s: number, i: any) => s + (i.comps_volume_ml || 0), 0)}</span> : '—'}</td>
                                <td style={tdStyle}>{items.reduce((s: number, i: any) => s + (i.end_volume_ml || 0), 0) || '—'}</td>
                                <td style={{ ...tdStyle, fontWeight: 700 }}>{items.reduce((s: number, i: any) => s + (i.consumed_volume_ml || 0), 0) || '—'}</td>
                                <td style={{ ...tdStyle, fontWeight: 700, color: '#dc3545' }}>${report.total_consumed_value?.toFixed(2)}</td>
                                <td style={tdStyle}></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};

const SummaryCard = ({ label, value, color }: { label: string; value: string; color: string }) => (
    <div style={{ padding: '1rem 1.25rem', borderRadius: 8, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: `4px solid ${color}` }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginTop: 4 }}>{value}</div>
    </div>
);

const Legend = ({ color, label }: { color: string; label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: color }} />
        <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
    </div>
);

const cardStyle: React.CSSProperties = { padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' };
const thStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 12 };
const tdStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 13 };

export default InventoryReport;
