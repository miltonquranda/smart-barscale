import React, { useEffect, useState } from 'react';
import api from '../api';

const AdminUsers = () => {
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [newUser, setNewUser] = useState({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        confirmPassword: '',
        businessName: '',
        businessZipCode: ''
    });

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const response = await api.get('/users');
            setUsers(response.data);
        } catch (err) {
            console.error('Failed to fetch users', err);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (user: any) => {
        if (window.confirm(`Are you sure you want to delete ${user.username}?`)) {
            try {
                await api.delete(`/user/${user._id}`);
                fetchUsers();
            } catch (err) {
                console.error('Failed to delete user', err);
                alert('Failed to delete user');
            }
        }
    };

    const handleAddUser = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newUser.password !== newUser.confirmPassword) {
            alert('Passwords do not match');
            return;
        }

        try {
            await api.post('/user', {
                username: newUser.email,
                email: newUser.email,
                firstName: newUser.firstName,
                lastName: newUser.lastName,
                password: newUser.password,
                role: 'user',
                business: [{
                    name: newUser.businessName,
                    zipCode: newUser.businessZipCode
                }]
            });
            alert('User created successfully');
            setNewUser({
                firstName: '',
                lastName: '',
                email: '',
                password: '',
                confirmPassword: '',
                businessName: '',
                businessZipCode: ''
            });
            fetchUsers();
        } catch (err: any) {
            console.error('Failed to create user', err);
            alert(err.response?.data?.error || 'Failed to create user');
        }
    };

    return (
        <div style={{ padding: '2rem' }}>
            <h1>Admin: Users</h1>

            {/* Add User Form */}
            <div style={{ marginBottom: '2rem', padding: '2rem', border: '1px solid var(--color-border)', borderRadius: '8px', backgroundColor: 'var(--color-surface)' }}>
                <h3>Add New User & Business</h3>
                <form onSubmit={handleAddUser} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>First Name</label>
                        <input
                            type="text"
                            value={newUser.firstName}
                            onChange={e => setNewUser({ ...newUser, firstName: e.target.value })}
                            required
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Last Name</label>
                        <input
                            type="text"
                            value={newUser.lastName}
                            onChange={e => setNewUser({ ...newUser, lastName: e.target.value })}
                            required
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Email</label>
                        <input
                            type="email"
                            value={newUser.email}
                            onChange={e => setNewUser({ ...newUser, email: e.target.value })}
                            required
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Password</label>
                        <input
                            type="password"
                            value={newUser.password}
                            onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                            required
                            minLength={6}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Confirm Password</label>
                        <input
                            type="password"
                            value={newUser.confirmPassword}
                            onChange={e => setNewUser({ ...newUser, confirmPassword: e.target.value })}
                            required
                            minLength={6}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Business Name</label>
                        <input
                            type="text"
                            value={newUser.businessName}
                            onChange={e => setNewUser({ ...newUser, businessName: e.target.value })}
                            required
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Business Zip Code</label>
                        <input
                            type="text"
                            value={newUser.businessZipCode}
                            onChange={e => setNewUser({ ...newUser, businessZipCode: e.target.value })}
                            required
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                        <button type="submit" style={{ padding: '0.75rem 1.5rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '1rem' }}>Create User</button>
                    </div>
                </form>
            </div>

            {/* User List */}
            {loading ? <p>Loading...</p> : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                            <th style={{ padding: '0.5rem' }}>Name</th>
                            <th style={{ padding: '0.5rem' }}>Email</th>
                            <th style={{ padding: '0.5rem' }}>Role</th>
                            <th style={{ padding: '0.5rem' }}>Business</th>
                            <th style={{ padding: '0.5rem' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user: any) => (
                            <tr key={user._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <td style={{ padding: '0.5rem' }}>{user.firstName} {user.lastName}</td>
                                <td style={{ padding: '0.5rem' }}>{user.email}</td>
                                <td style={{ padding: '0.5rem' }}>{user.role}</td>
                                <td style={{ padding: '0.5rem' }}>
                                    {user.business && user.business.length > 0 ? user.business.map((b: any) => b.name).join(', ') : 'None'}
                                </td>
                                <td style={{ padding: '0.5rem' }}>
                                    <button
                                        onClick={() => handleDelete(user)}
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

export default AdminUsers;
