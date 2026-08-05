import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Layout from './components/Layout';
import Account from './pages/Account';
import Dashboard from './pages/Dashboard';
import AdminUsers from './pages/AdminUsers';
import AdminDevices from './pages/AdminDevices';
import Bottles from './pages/Bottles';
import Products from './pages/Products';
import Categories from './pages/Categories';
import Inventory from './pages/Inventory';
import InventorySession from './pages/InventorySession';
import InventoryReport from './pages/InventoryReport';
import PrivateRoute from './components/PrivateRoute';
import PlatformAdmin from './pages/PlatformAdmin';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        {/* We do NOT map the root path ("/") here anymore. 
            Firebase will serve the landing page for the root path.
            If a user hits / within the react router, it will fall through
            or they can just use the explicit /dashboard link. */}
        <Route path="/dashboard" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
        <Route path="/bottles" element={<PrivateRoute><Bottles /></PrivateRoute>} />
        <Route path="/products" element={<PrivateRoute><Products /></PrivateRoute>} />
        <Route path="/categories" element={<PrivateRoute><Categories /></PrivateRoute>} />
        <Route path="/inventory" element={<PrivateRoute><Inventory /></PrivateRoute>} />
        <Route path="/inventory/session/:id" element={<PrivateRoute><InventorySession /></PrivateRoute>} />
        <Route path="/inventory/report/:id" element={<PrivateRoute><InventoryReport /></PrivateRoute>} />
        <Route path="/account" element={<PrivateRoute><Account /></PrivateRoute>} />
        <Route path="/admin/users" element={<PrivateRoute><AdminUsers /></PrivateRoute>} />
        <Route path="/admin/devices" element={<PrivateRoute><AdminDevices /></PrivateRoute>} />
        <Route path="/platform" element={<PrivateRoute><PlatformAdmin /></PrivateRoute>} />
      </Route>
    </Routes>
  );
}

export default App;
