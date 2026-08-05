import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

type NavItem = { label: string; to: string };

const primaryItems: NavItem[] = [
    { label: 'Dashboard', to: '/dashboard' },
    { label: 'Products', to: '/products' },
    { label: 'Categories', to: '/categories' },
    { label: 'Inventory', to: '/inventory' },
];

const Navbar = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [menuOpen, setMenuOpen] = useState(false);
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const isAdmin = user.role === 'admin';

    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        navigate('/login');
    };

    if (!localStorage.getItem('token')) return null;

    const isActive = (to: string) => location.pathname === to || location.pathname.startsWith(`${to}/`);

    return (
        <header className="app-nav">
            <div className="nav-shell">
                <Link to="/dashboard" className="brand" aria-label="SmartBar dashboard">
                    <img className="brand-logo" src="/smart_bar_logo_cropped.png" alt="SmartBar" />
                    <span className="brand-context">Inventory intelligence</span>
                </Link>

                <button
                    className="nav-toggle"
                    type="button"
                    aria-expanded={menuOpen}
                    aria-controls="primary-navigation"
                    aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                    onClick={() => setMenuOpen(value => !value)}
                >
                    <span /><span /><span />
                </button>

                <div id="primary-navigation" className={`nav-content${menuOpen ? ' is-open' : ''}`}>
                    <nav className="nav-links" aria-label="Primary navigation">
                        {primaryItems.map(item => (
                            <Link key={item.to} to={item.to} onClick={() => setMenuOpen(false)} className={`nav-link${isActive(item.to) ? ' is-active' : ''}`}>
                                {item.label}
                            </Link>
                        ))}
                    </nav>
                    <div className="nav-divider" />
                    <nav className="nav-links nav-secondary" aria-label="Account navigation">
                        <Link to="/account" onClick={() => setMenuOpen(false)} className={`nav-link${isActive('/account') ? ' is-active' : ''}`}>Account</Link>
                        {isAdmin && <>
                            <Link to="/platform" onClick={() => setMenuOpen(false)} className={`nav-link${isActive('/platform') ? ' is-active' : ''}`}>Platform</Link>
                            <Link to="/admin/users" onClick={() => setMenuOpen(false)} className={`nav-link${isActive('/admin/users') ? ' is-active' : ''}`}>Users</Link>
                            <Link to="/admin/devices" onClick={() => setMenuOpen(false)} className={`nav-link${isActive('/admin/devices') ? ' is-active' : ''}`}>Devices</Link>
                        </>}
                    </nav>
                    <div className="nav-user">
                        <div className="user-avatar" aria-hidden="true">{(user.firstName || user.email || 'U').charAt(0).toUpperCase()}</div>
                        <span className="user-name">{user.firstName || 'User'}</span>
                        <button className="logout-button" type="button" onClick={handleLogout}>Log out</button>
                    </div>
                </div>
            </div>
        </header>
    );
};

export default Navbar;
