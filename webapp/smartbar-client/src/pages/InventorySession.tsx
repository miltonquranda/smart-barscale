import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../api';

const InventorySessionView = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [session, setSession] = useState<any>(null);
    const [readings, setReadings] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetch = async () => {
            try {
                const [sessResp, readResp] = await Promise.all([
                    api.get(`/inventory/session/${id}`),
                    api.get(`/inventory/readings?session_id=${id}&limit=200`),
                ]);
                setSession(sessResp.data);
                setReadings(readResp.data);
            } catch (err) {
                console.error(err);
            } finally { setLoading(false); }
        };
        fetch();
    }, [id]);

    if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>;
    if (!session) return <div style={{ padding: '2rem', color: 'var(--color-text)' }}>Session not found.</div>;

    const totalValue = readings.reduce((s, r) => s + (r.total_value_on_hand || 0), 0);
    const totalVolume = readings.reduce((s, r) => s + (r.total_volume_on_hand_ml || 0), 0);

    // Unique products
    const byProduct = new Map<string, any[]>();
    readings.forEach(r => {
        if (!byProduct.has(r.barcode)) byProduct.set(r.barcode, []);
        byProduct.get(r.barcode)!.push(r);
    });

    return (
        <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
            <button onClick={() => navigate('/inventory')}
                style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', padding: 0, fontSize: 14, marginBottom: 8 }}>
                ← Back to Inventory
            </button>
            <h1 style={{ color: 'var(--color-text)', margin: '0 0 0.25rem' }}>{session.label}</h1>
            <div style={{ display: 'flex', gap: 12, marginBottom: '1.5rem' }}>
                <span style={{
                    fontSize: 12, padding: '3px 10px', borderRadius: 10, fontWeight: 500,
                    backgroundColor: session.status === 'active' ? '#28a74522' : session.status === 'paused' ? '#f0ad4e22' : '#6c757d22',
                    color: session.status === 'active' ? '#28a745' : session.status === 'paused' ? '#f0ad4e' : '#6c757d',
                }}>{session.status}</span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                    {readings.length} reading{readings.length !== 1 ? 's' : ''} · {byProduct.size} product{byProduct.size !== 1 ? 's' : ''}
                </span>
            </div>

            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                <SummaryCard label="Total Volume" value={`${(totalVolume / 1000).toFixed(1)} L`} color="#007bff" />
                <SummaryCard label="Total Value" value={`$${totalValue.toFixed(2)}`} color="#28a745" />
                <SummaryCard label="Products" value={String(byProduct.size)} color="#f0ad4e" />
                <SummaryCard label="Readings" value={String(readings.length)} color="#6c757d" />
            </div>

            {/* Product Summaries */}
            <div style={{ ...cardStyle, marginBottom: '2rem' }}>
                <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Products in Session</h3>
                {byProduct.size === 0 ? (
                    <p style={{ color: 'var(--color-text-muted)' }}>No readings in this session yet.</p>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                                <th style={thStyle}>Product</th>
                                <th style={thStyle}>Barcode</th>
                                <th style={thStyle}>Latest Weight</th>
                                <th style={thStyle}>Sealed</th>
                                <th style={thStyle}>Volume</th>
                                <th style={thStyle}>Value</th>
                                <th style={thStyle}>Scans</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Array.from(byProduct.entries()).map(([barcode, rds]) => {
                                const latest = rds[0];
                                return (
                                    <tr key={barcode} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={tdStyle}>
                                            <div>{latest.product_name || '—'}</div>
                                            {latest.product_brand && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{latest.product_brand}</div>}
                                        </td>
                                        <td style={tdStyle}><code style={{ fontSize: 12 }}>{barcode}</code></td>
                                        <td style={tdStyle}>{latest.weight_g ? `${latest.weight_g}g` : '—'}</td>
                                        <td style={tdStyle}>{latest.sealed_count || 0}</td>
                                        <td style={{ ...tdStyle, fontWeight: 600 }}>
                                            {latest.total_volume_on_hand_ml ? `${latest.total_volume_on_hand_ml} ml` : '—'}
                                        </td>
                                        <td style={{ ...tdStyle, fontWeight: 600, color: '#28a745' }}>
                                            {latest.total_value_on_hand ? `$${latest.total_value_on_hand.toFixed(2)}` : '—'}
                                        </td>
                                        <td style={tdStyle}>{rds.length}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* All Readings Timeline */}
            <div style={cardStyle}>
                <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>All Readings</h3>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                                <th style={thStyle}>Time</th>
                                <th style={thStyle}>Product</th>
                                <th style={thStyle}>Weight</th>
                                <th style={thStyle}>Volume</th>
                                <th style={thStyle}>Change</th>
                            </tr>
                        </thead>
                        <tbody>
                            {readings.map(r => {
                                const change = r.volume_change_ml || 0;
                                const isNew = r.prev_volume_on_hand_ml === null;
                                const ts = r.timestamp?._seconds ? new Date(r.timestamp._seconds * 1000) : null;
                                return (
                                    <tr key={r._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td style={tdStyle}>
                                            {ts ? <span style={{ fontSize: 12 }}>{ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {ts.toLocaleDateString()}</span> : '—'}
                                        </td>
                                        <td style={tdStyle}>{r.product_name || r.barcode}</td>
                                        <td style={tdStyle}>{r.weight_g ? `${r.weight_g}g` : '—'}</td>
                                        <td style={tdStyle}>{r.total_volume_on_hand_ml ? `${r.total_volume_on_hand_ml} ml` : '—'}</td>
                                        <td style={tdStyle}>
                                            {isNew ? (
                                                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, backgroundColor: '#007bff22', color: '#007bff' }}>first</span>
                                            ) : change === 0 ? '—' : (
                                                <span style={{ fontWeight: 600, color: change > 0 ? '#dc3545' : '#28a745' }}>
                                                    {change > 0 ? `−${change}` : `+${Math.abs(change)}`} ml
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
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

const cardStyle: React.CSSProperties = { padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' };
const thStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 13 };
const tdStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 13 };

export default InventorySessionView;
