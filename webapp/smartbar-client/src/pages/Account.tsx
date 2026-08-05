import React, { useEffect, useState } from 'react';
import api from '../api';

const Account = () => {
    const [user, setUser] = useState<any>({});
    const [customer, setCustomer] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: ''
    });

    useEffect(() => {
        fetchUser();
    }, []);

    const fetchUser = async () => {
        try {
            const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
            if (storedUser._id) {
                const response = await api.get(`/user/${storedUser._id}`);
                setUser(response.data);
                setFormData({
                    firstName: response.data.firstName,
                    lastName: response.data.lastName,
                    email: response.data.email
                });

                if (response.data.customer_id) {
                    fetchStripeCustomer(response.data.customer_id);
                }
            }
        } catch (err) {
            console.error('Failed to fetch user', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchStripeCustomer = async (customerId: string) => {
        try {
            const response = await api.get(`/stripe/customer/${customerId}`);
            setCustomer(response.data);
        } catch (err) {
            console.error('Failed to fetch stripe customer', err);
        }
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            await api.put(`/user/${user._id}`, formData);
            setIsEditing(false);
            fetchUser(); // Refresh data
            alert('Account updated successfully');
        } catch (err) {
            console.error('Failed to update account', err);
            alert('Failed to update account');
        }
    };

    if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>;

    return (
        <div style={{ padding: '2rem', maxWidth: '800px' }}>
            <h1>Account Settings</h1>

            <div style={{ marginTop: '2rem', padding: '2rem', border: '1px solid var(--color-border)', borderRadius: '8px', backgroundColor: 'var(--color-surface)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                    <h3>Profile Information</h3>
                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        style={{
                            padding: '0.5rem 1rem',
                            backgroundColor: isEditing ? '#6c757d' : '#007bff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        {isEditing ? 'Cancel' : 'Edit Profile'}
                    </button>
                </div>

                {isEditing ? (
                    <form onSubmit={handleUpdate}>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>First Name</label>
                            <input
                                type="text"
                                value={formData.firstName}
                                onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Last Name</label>
                            <input
                                type="text"
                                value={formData.lastName}
                                onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>Email</label>
                            <input
                                type="email"
                                value={formData.email}
                                disabled
                                style={{ width: '100%' }}
                            />
                            <small style={{ color: 'var(--color-text-muted)' }}>Email cannot be changed.</small>
                        </div>
                        <button type="submit" style={{ padding: '0.5rem 1rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Save Changes</button>
                    </form>
                ) : (
                    <div>
                        <p><strong>Name:</strong> {user.firstName} {user.lastName}</p>
                        <p><strong>Email:</strong> {user.email}</p>
                        <p><strong>Role:</strong> {user.role}</p>
                    </div>
                )}
            </div>

            {customer && (
                <div style={{ marginTop: '2rem', padding: '2rem', border: '1px solid var(--color-border)', borderRadius: '8px', backgroundColor: 'var(--color-surface)' }}>
                    <h3>Subscription Details</h3>
                    <p><strong>Status:</strong> {customer.subscriptions?.data[0]?.status || 'Inactive'}</p>
                    <p><strong>Plan:</strong> {customer.subscriptions?.data[0]?.plan?.nickname || 'Unknown'}</p>
                    <p><strong>Current Period End:</strong> {new Date(customer.subscriptions?.data[0]?.current_period_end * 1000).toLocaleDateString()}</p>
                </div>
            )}
        </div>
    );
};

export default Account;
