import React, { useEffect, useState } from 'react';
import api from '../api';

const Bottles = () => {
    const [bottles, setBottles] = useState<any[]>([]);
    const [user, setUser] = useState<any>({});
    const [newBottle, setNewBottle] = useState({ name: '', brand: '', barcode: '' });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
            setUser(JSON.parse(storedUser));
        }
    }, []);

    useEffect(() => {
        if (user.business && user.business.length > 0) {
            fetchBottles();
        }
    }, [user]);

    const fetchBottles = async () => {
        try {
            const businessId = user.business[0]._id;
            const response = await api.get(`/bottles/${businessId}`);
            // Backend returns object { id: bottle }, convert to array
            setBottles(Object.values(response.data));
        } catch (err) {
            console.error('Failed to fetch bottles', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddBottle = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.post('/bottle', newBottle);
            setNewBottle({ name: '', brand: '', barcode: '' });
            fetchBottles(); // Refresh list
        } catch (err) {
            console.error('Failed to add bottle', err);
            alert('Failed to add bottle');
        }
    };

    return (
        <div style={{ padding: '2rem' }}>
            <h1>Bottles</h1>

            <div style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid var(--color-border)', borderRadius: '4px', backgroundColor: 'var(--color-surface)' }}>
                <h3>Add New Bottle</h3>
                <form onSubmit={handleAddBottle} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Name</label>
                        <input
                            type="text"
                            value={newBottle.name}
                            onChange={e => setNewBottle({ ...newBottle, name: e.target.value })}
                            required
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Brand</label>
                        <input
                            type="text"
                            value={newBottle.brand}
                            onChange={e => setNewBottle({ ...newBottle, brand: e.target.value })}
                            required
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Barcode</label>
                        <input
                            type="text"
                            value={newBottle.barcode}
                            onChange={e => setNewBottle({ ...newBottle, barcode: e.target.value })}
                            required
                        />
                    </div>
                    <button type="submit" style={{ padding: '0.5rem 1rem', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Add Bottle</button>
                </form>
            </div>

            {loading ? <p>Loading...</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                            <th style={{ padding: '0.5rem' }}>Name</th>
                            <th style={{ padding: '0.5rem' }}>Brand</th>
                            <th style={{ padding: '0.5rem' }}>Barcode</th>
                        </tr>
                    </thead>
                    <tbody>
                        {bottles.length === 0 ? (
                            <tr><td colSpan={3} style={{ padding: '1rem', textAlign: 'center' }}>No bottles found.</td></tr>
                        ) : (
                            bottles.map((bottle: any) => (
                                <tr key={bottle._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                    <td style={{ padding: '0.5rem' }}>{bottle.name}</td>
                                    <td style={{ padding: '0.5rem' }}>{bottle.brand}</td>
                                    <td style={{ padding: '0.5rem' }}>{bottle.barcode}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default Bottles;
