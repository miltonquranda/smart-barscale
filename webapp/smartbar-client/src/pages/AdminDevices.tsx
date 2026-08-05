import React, { useEffect, useState } from 'react';
import api from '../api';

const AdminDevices = () => {
    const [devices, setDevices] = useState<any[]>([]);
    const [businesses, setBusinesses] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [newDevice, setNewDevice] = useState({
        serialNumber: '',
        type: '',
        businessId: ''
    });

    useEffect(() => {
        fetchDevices();
        fetchBusinesses();
    }, []);

    const fetchDevices = async () => {
        try {
            const response = await api.get('/devices');
            setDevices(response.data);
        } catch (err) {
            console.error('Failed to fetch devices', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchBusinesses = async () => {
        try {
            const response = await api.get('/businesses');
            setBusinesses(response.data);
        } catch (err) {
            console.error('Failed to fetch businesses', err);
        }
    };

    const handleDelete = async (device: any) => {
        if (window.confirm(`Are you sure you want to delete device ${device.serialNumber}?`)) {
            try {
                await api.delete(`/device/${device._id}`);
                fetchDevices();
            } catch (err) {
                console.error('Failed to delete device', err);
                alert('Failed to delete device');
            }
        }
    };

    const handleAssignBusiness = async (device: any, businessId: string) => {
        try {
            await api.put(`/device/${device._id}`, { business: businessId || null });
            fetchDevices();
        } catch (err) {
            console.error('Failed to assign business', err);
            alert('Failed to assign business');
        }
    };

    const handleAddDevice = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/device', {
                serialNumber: newDevice.serialNumber,
                type: newDevice.type,
                business: newDevice.businessId
            });
            alert('Device created successfully');
            setNewDevice({
                serialNumber: '',
                type: '',
                businessId: ''
            });
            fetchDevices();
        } catch (err: any) {
            console.error('Failed to create device', err);
            alert(err.response?.data?.error || 'Failed to create device');
        }
    };

    return (
        <div style={{ padding: '2rem' }}>
            <h1>Admin: Devices</h1>

            {/* Add Device Form */}
            <div style={{ marginBottom: '2rem', padding: '2rem', border: '1px solid var(--color-border)', borderRadius: '8px', backgroundColor: 'var(--color-surface)' }}>
                <h3>Add New Device</h3>
                <form onSubmit={handleAddDevice} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Serial Number</label>
                        <input
                            type="text"
                            value={newDevice.serialNumber}
                            onChange={e => setNewDevice({ ...newDevice, serialNumber: e.target.value })}
                            required
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Type</label>
                        <input
                            type="text"
                            value={newDevice.type}
                            onChange={e => setNewDevice({ ...newDevice, type: e.target.value })}
                            required
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Business</label>
                        <select
                            value={newDevice.businessId}
                            onChange={e => setNewDevice({ ...newDevice, businessId: e.target.value })}
                            required
                            style={{ minWidth: '200px' }}
                        >
                            <option value="">Select Business</option>
                            {businesses.map((b: any) => (
                                <option key={b._id} value={b._id}>{b.name} ({b.zipCode})</option>
                            ))}
                        </select>
                    </div>
                    <button type="submit" style={{ padding: '0.5rem 1rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Add Device</button>
                </form>
            </div>

            {/* Device List */}
            {loading ? <p>Loading...</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                            <th style={{ padding: '0.5rem' }}>Serial Number</th>
                            <th style={{ padding: '0.5rem' }}>Type</th>
                            <th style={{ padding: '0.5rem' }}>Business</th>
                            <th style={{ padding: '0.5rem' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {devices.map((device: any) => (
                            <tr key={device._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <td style={{ padding: '0.5rem' }}>{device.serialNumber}</td>
                                <td style={{ padding: '0.5rem' }}>{device.type || '—'}</td>
                                <td style={{ padding: '0.5rem' }}>
                                    <select
                                        value={device.business?._id || device.business || ''}
                                        onChange={e => handleAssignBusiness(device, e.target.value)}
                                        style={{ minWidth: '180px' }}
                                    >
                                        <option value="">Unassigned</option>
                                        {businesses.map((b: any) => (
                                            <option key={b._id} value={b._id}>{b.name}{b.zipCode ? ` (${b.zipCode})` : ''}</option>
                                        ))}
                                    </select>
                                </td>
                                <td style={{ padding: '0.5rem' }}>
                                    <button
                                        onClick={() => handleDelete(device)}
                                        style={{ padding: '0.25rem 0.5rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                    >
                                        Delete
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default AdminDevices;
