import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const Inventory = () => {
    const navigate = useNavigate();
    const [readings, setReadings] = useState<any[]>([]);
    const [sessions, setSessions] = useState<any[]>([]);
    const [events, setEvents] = useState<any[]>([]);
    const [reports, setReports] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Session form
    const [sessionLabel, setSessionLabel] = useState('');
    const [creatingSess, setCreatingSess] = useState(false);

    // Event form
    const [showEventForm, setShowEventForm] = useState(false);
    const [eventForm, setEventForm] = useState({ barcode: '', event_type: 'delivery', quantity: '', notes: '', date: todayStr() });
    const [eventSaving, setEventSaving] = useState(false);

    // Report form
    const [showReportForm, setShowReportForm] = useState(false);
    const [reportStart, setReportStart] = useState(weekAgo());
    const [reportEnd, setReportEnd] = useState(todayStr());
    const [generatingReport, setGeneratingReport] = useState(false);

    useEffect(() => {
        Promise.all([
            api.get('/inventory/readings?limit=50').then(r => setReadings(r.data)).catch(() => {}),
            api.get('/inventory/sessions?limit=10').then(r => setSessions(r.data)).catch(() => {}),
            api.get('/inventory/events?limit=15').then(r => setEvents(r.data)).catch(() => {}),
            api.get('/inventory/reports?limit=10').then(r => setReports(r.data)).catch(() => {}),
        ]).finally(() => setLoading(false));
    }, []);

    const activeSession = sessions.find(s => s.status === 'active');

    const startSession = async () => {
        if (!sessionLabel.trim()) return;
        setCreatingSess(true);
        try {
            const resp = await api.post('/inventory/session', { label: sessionLabel.trim() });
            setSessions(prev => [resp.data, ...prev]);
            setSessionLabel('');
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed');
        } finally { setCreatingSess(false); }
    };

    const updateSession = async (id: string, status: string, reason?: string) => {
        try {
            const body: any = { status };
            if (reason) body.closed_reason = reason;
            const resp = await api.put(`/inventory/session/${id}`, body);
            setSessions(prev => prev.map(s => s._id === id ? resp.data : s));
        } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
    };

    const handleEventSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!eventForm.barcode.trim()) return;
        setEventSaving(true);
        try {
            const resp = await api.post('/inventory/event', eventForm);
            setEvents(prev => [resp.data, ...prev]);
            setEventForm({ barcode: '', event_type: 'delivery', quantity: '', notes: '', date: todayStr() });
            setShowEventForm(false);
        } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
        finally { setEventSaving(false); }
    };

    const deleteEvent = async (id: string) => {
        if (!confirm('Delete this event?')) return;
        try { await api.delete(`/inventory/event/${id}`); setEvents(prev => prev.filter(e => e._id !== id)); } catch (_) {}
    };

    const generateReport = async () => {
        setGeneratingReport(true);
        try {
            const resp = await api.post('/inventory/report', { start_date: reportStart, end_date: reportEnd });
            navigate(`/inventory/report/${resp.data._id}`);
        } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
        finally { setGeneratingReport(false); }
    };

    // Group recent readings by product for a snapshot
    const latestByProduct = new Map<string, any>();
    readings.forEach(r => {
        if (!latestByProduct.has(r.barcode)) latestByProduct.set(r.barcode, r);
    });
    const snapshot = Array.from(latestByProduct.values());
    const totalValue = snapshot.reduce((s, r) => s + (r.total_value_on_hand || 0), 0);
    const totalVolume = snapshot.reduce((s, r) => s + (r.total_volume_on_hand_ml || 0), 0);

    return (
        <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
            <h1 style={{ color: 'var(--color-text)', margin: '0 0 1.5rem' }}>Inventory</h1>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                <SummaryCard label="Products Tracked" value={String(snapshot.length)} color="#007bff" />
                <SummaryCard label="Total Volume" value={`${(totalVolume / 1000).toFixed(1)} L`} color="#28a745" />
                <SummaryCard label="Total Value" value={`$${totalValue.toFixed(2)}`} color="#f0ad4e" />
                <SummaryCard label="Session" value={activeSession ? 'Active' : 'None'}
                    color={activeSession ? '#28a745' : '#6c757d'}
                    subtitle={activeSession?.label} />
            </div>

            {/* Actions Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                {/* Session Control */}
                <div style={cardStyle}>
                    <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 15 }}>Tracking Session</h3>
                    {activeSession ? (
                        <div>
                            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0.5rem 0' }}>
                                <strong>{activeSession.label}</strong> — {activeSession.reading_count || 0} readings
                            </p>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => updateSession(activeSession._id, 'paused')}
                                    style={{ ...btnStyle('#f0ad4e'), flex: 1, color: '#333' }}>Pause</button>
                                <button onClick={() => updateSession(activeSession._id, 'closed', 'manual')}
                                    style={{ ...btnStyle('#dc3545'), flex: 1 }}>Close</button>
                            </div>
                        </div>
                    ) : (
                        <div>
                            <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0.5rem 0 0.75rem' }}>
                                No active session. Readings still flow in — sessions are optional labels for comparison.
                            </p>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <input value={sessionLabel} onChange={e => setSessionLabel(e.target.value)}
                                    placeholder="e.g. Weekly Count" style={{ ...inputStyle, flex: 1 }}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); startSession(); } }} />
                                <button onClick={startSession} disabled={creatingSess || !sessionLabel.trim()}
                                    style={btnStyle('#28a745')}>Start</button>
                            </div>
                            {sessions.find(s => s.status === 'paused') && (
                                <button onClick={() => updateSession(sessions.find(s => s.status === 'paused')!._id, 'active')}
                                    style={{ ...btnStyle('#007bff'), width: '100%', marginTop: 8 }}>
                                    Resume "{sessions.find(s => s.status === 'paused')!.label}"
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Log Event */}
                <div style={cardStyle}>
                    <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 15 }}>Log Event</h3>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0.5rem 0 0.75rem' }}>
                        Record deliveries, breakage, comps between scans.
                    </p>
                    <button onClick={() => setShowEventForm(!showEventForm)}
                        style={{ ...btnStyle(showEventForm ? '#6c757d' : '#007bff'), width: '100%' }}>
                        {showEventForm ? 'Cancel' : 'Log Event'}
                    </button>
                </div>

                {/* Generate Report */}
                <div style={cardStyle}>
                    <h3 style={{ color: 'var(--color-text)', marginTop: 0, fontSize: 15 }}>Report</h3>
                    <p style={{ color: 'var(--color-text-muted)', fontSize: 13, margin: '0.5rem 0 0.75rem' }}>
                        Generate a consumption report for any date range.
                    </p>
                    <button onClick={() => setShowReportForm(!showReportForm)}
                        style={{ ...btnStyle(showReportForm ? '#6c757d' : '#28a745'), width: '100%' }}>
                        {showReportForm ? 'Cancel' : 'Generate Report'}
                    </button>
                </div>
            </div>

            {/* Event Form */}
            {showEventForm && (
                <div style={{ ...cardStyle, marginBottom: '2rem' }}>
                    <form onSubmit={handleEventSave}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                            <div><label style={labelStyle}>Barcode *</label>
                                <input value={eventForm.barcode} onChange={e => setEventForm({ ...eventForm, barcode: e.target.value })} required style={inputStyle} /></div>
                            <div><label style={labelStyle}>Type</label>
                                <select value={eventForm.event_type} onChange={e => setEventForm({ ...eventForm, event_type: e.target.value })} style={{ ...inputStyle, appearance: 'auto' }}>
                                    <option value="delivery">Delivery</option><option value="breakage">Breakage</option>
                                    <option value="comp">Comp</option><option value="spoilage">Spoilage</option>
                                    <option value="transfer_in">Transfer In</option><option value="transfer_out">Transfer Out</option>
                                    <option value="other">Other</option></select></div>
                            <div><label style={labelStyle}>Quantity</label>
                                <input type="number" value={eventForm.quantity} onChange={e => setEventForm({ ...eventForm, quantity: e.target.value })} min="0" style={inputStyle} /></div>
                            <div><label style={labelStyle}>Date</label>
                                <input type="date" value={eventForm.date} onChange={e => setEventForm({ ...eventForm, date: e.target.value })} style={inputStyle} /></div>
                            <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Notes</label>
                                <input value={eventForm.notes} onChange={e => setEventForm({ ...eventForm, notes: e.target.value })} style={inputStyle} /></div>
                        </div>
                        <button type="submit" disabled={eventSaving} style={{ ...btnStyle('#28a745'), marginTop: '1rem' }}>
                            {eventSaving ? 'Saving...' : 'Save'}</button>
                    </form>
                </div>
            )}

            {/* Report Form */}
            {showReportForm && (
                <div style={{ ...cardStyle, marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                        <div><label style={labelStyle}>Start Date</label>
                            <input type="date" value={reportStart} onChange={e => setReportStart(e.target.value)} style={inputStyle} /></div>
                        <div><label style={labelStyle}>End Date</label>
                            <input type="date" value={reportEnd} onChange={e => setReportEnd(e.target.value)} style={inputStyle} /></div>
                        <button onClick={generateReport} disabled={generatingReport} style={btnStyle('#28a745')}>
                            {generatingReport ? 'Generating...' : 'Generate'}</button>
                    </div>
                </div>
            )}

            {/* Live Readings Feed */}
            <div style={{ ...cardStyle, marginBottom: '2rem' }}>
                <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Recent Readings</h3>
                {loading ? <p>Loading...</p> : readings.length === 0 ? (
                    <p style={{ color: 'var(--color-text-muted)' }}>No readings yet. Scan a product with the device to start.</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                                    <th style={thStyle}>Time</th>
                                    <th style={thStyle}>Product</th>
                                    <th style={thStyle}>Weight</th>
                                    <th style={thStyle}>Sealed</th>
                                    <th style={thStyle}>Volume</th>
                                    <th style={thStyle}>Value</th>
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
                                                {ts ? <span style={{ fontSize: 12 }}>{ts.toLocaleDateString()} {ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : '—'}
                                            </td>
                                            <td style={tdStyle}>
                                                <div>{r.product_name || r.barcode}</div>
                                                {r.product_brand && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{r.product_brand}</div>}
                                            </td>
                                            <td style={tdStyle}>{r.weight_g ? `${r.weight_g}g` : '—'}</td>
                                            <td style={tdStyle}>{r.sealed_count || 0}</td>
                                            <td style={tdStyle}>{r.total_volume_on_hand_ml ? `${r.total_volume_on_hand_ml} ml` : '—'}</td>
                                            <td style={{ ...tdStyle, color: '#28a745', fontWeight: 600 }}>
                                                {r.total_value_on_hand ? `$${r.total_value_on_hand.toFixed(2)}` : '—'}
                                            </td>
                                            <td style={tdStyle}>
                                                {isNew ? (
                                                    <span style={{ ...badgeStyle, backgroundColor: '#007bff22', color: '#007bff' }}>first</span>
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
                )}
            </div>

            {/* Sessions History */}
            {sessions.length > 0 && (
                <div style={{ ...cardStyle, marginBottom: '2rem' }}>
                    <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Sessions</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                                <th style={thStyle}>Label</th>
                                <th style={thStyle}>Status</th>
                                <th style={thStyle}>Readings</th>
                                <th style={thStyle}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sessions.map(s => (
                                <tr key={s._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={tdStyle}>{s.label}</td>
                                    <td style={tdStyle}>
                                        <span style={{
                                            ...badgeStyle,
                                            backgroundColor: statusColors[s.status]?.bg || '#99922',
                                            color: statusColors[s.status]?.fg || '#999',
                                        }}>{s.status}</span>
                                    </td>
                                    <td style={tdStyle}>{s.reading_count || 0}</td>
                                    <td style={tdStyle}>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <button onClick={() => navigate(`/inventory/session/${s._id}`)}
                                                style={{ ...btnStyle('#007bff'), padding: '3px 8px', fontSize: 11 }}>View</button>
                                            {s.status === 'active' && (
                                                <button onClick={() => updateSession(s._id, 'closed', 'manual')}
                                                    style={{ ...btnStyle('#dc3545'), padding: '3px 8px', fontSize: 11 }}>Close</button>
                                            )}
                                            {s.status === 'paused' && (
                                                <button onClick={() => updateSession(s._id, 'active')}
                                                    style={{ ...btnStyle('#28a745'), padding: '3px 8px', fontSize: 11 }}>Resume</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Events */}
            {events.length > 0 && (
                <div style={{ ...cardStyle, marginBottom: '2rem' }}>
                    <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Recent Events</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                            <th style={thStyle}>Date</th><th style={thStyle}>Barcode</th><th style={thStyle}>Type</th>
                            <th style={thStyle}>Qty</th><th style={thStyle}>Notes</th><th style={thStyle}></th>
                        </tr></thead>
                        <tbody>{events.map(ev => (
                            <tr key={ev._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <td style={tdStyle}>{ev.date}</td>
                                <td style={tdStyle}><code>{ev.barcode}</code></td>
                                <td style={tdStyle}><span style={{ ...badgeStyle, backgroundColor: (evtColors[ev.event_type] || '#999') + '22', color: evtColors[ev.event_type] || '#999' }}>{ev.event_type}</span></td>
                                <td style={tdStyle}>{ev.quantity}</td>
                                <td style={tdStyle}>{ev.notes || '—'}</td>
                                <td style={tdStyle}><button onClick={() => deleteEvent(ev._id)} style={{ ...btnStyle('#dc3545'), padding: '3px 8px', fontSize: 11 }}>✕</button></td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}

            {/* Reports */}
            {reports.length > 0 && (
                <div style={cardStyle}>
                    <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Reports</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                            <th style={thStyle}>Period</th><th style={thStyle}>Products</th>
                            <th style={thStyle}>Start Value</th><th style={thStyle}>End Value</th>
                            <th style={thStyle}>Consumed</th><th style={thStyle}></th>
                        </tr></thead>
                        <tbody>{reports.map(r => (
                            <tr key={r._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <td style={tdStyle}>{r.start_date} → {r.end_date}</td>
                                <td style={tdStyle}>{r.products_tracked || 0}</td>
                                <td style={tdStyle}>${r.total_start_value?.toFixed(2)}</td>
                                <td style={tdStyle}>${r.total_end_value?.toFixed(2)}</td>
                                <td style={{ ...tdStyle, fontWeight: 600, color: '#dc3545' }}>${r.total_consumed_value?.toFixed(2)}</td>
                                <td style={tdStyle}><button onClick={() => navigate(`/inventory/report/${r._id}`)} style={{ ...btnStyle('#007bff'), padding: '3px 8px', fontSize: 11 }}>View</button></td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

function todayStr() { return new Date().toISOString().split('T')[0]; }
function weekAgo() { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; }

const statusColors: Record<string, { bg: string; fg: string }> = {
    active: { bg: '#28a74522', fg: '#28a745' },
    paused: { bg: '#f0ad4e22', fg: '#f0ad4e' },
    closed: { bg: '#6c757d22', fg: '#6c757d' },
};
const evtColors: Record<string, string> = {
    delivery: '#28a745', breakage: '#dc3545', comp: '#f0ad4e',
    spoilage: '#dc3545', transfer_in: '#007bff', transfer_out: '#6c757d', other: '#999',
};

const SummaryCard = ({ label, value, color, subtitle }: { label: string; value: string; color: string; subtitle?: string }) => (
    <div style={{ padding: '1rem 1.25rem', borderRadius: 8, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderLeft: `4px solid ${color}` }}>
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text)', marginTop: 4 }}>{value}</div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{subtitle}</div>}
    </div>
);

const cardStyle: React.CSSProperties = { padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' };
const btnStyle = (bg: string): React.CSSProperties => ({ padding: '0.5rem 1rem', backgroundColor: bg, color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14 });
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-muted)' };
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };
const thStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 13 };
const tdStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)', fontSize: 13 };
const badgeStyle: React.CSSProperties = { fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 500 };

export default Inventory;
