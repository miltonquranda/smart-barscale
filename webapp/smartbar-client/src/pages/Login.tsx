import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const response = await api.post('/login', { email, password });
            localStorage.setItem('token', response.data.token);
            localStorage.setItem('user', JSON.stringify(response.data.user));
            navigate('/dashboard');
        } catch (err: any) {
            console.error('Login Error:', err);
            setError(err.response?.data?.error || err.message || 'Login failed');
        }
    };

    return (
        <div className="login-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
            <div style={{ padding: '2rem', backgroundColor: 'var(--color-surface)', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.2)', width: '100%', maxWidth: '400px', border: '1px solid var(--color-border)' }}>
                <h2 style={{ textAlign: 'center', marginBottom: '1.5rem' }}>SmartBar Login</h2>
                {error && <div style={{ color: '#dc3545', marginBottom: '1rem', textAlign: 'center' }}>{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                            style={{ width: '100%', padding: '0.75rem', fontSize: '1rem' }}
                        />
                    </div>
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            style={{ width: '100%', padding: '0.75rem', fontSize: '1rem' }}
                        />
                    </div>
                    <button
                        type="submit"
                        style={{ width: '100%', padding: '0.75rem', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', fontSize: '1rem', cursor: 'pointer', transition: 'background-color 0.2s' }}
                    >
                        Login
                    </button>
                </form>
            </div>
        </div>
    );
};

export default Login;
