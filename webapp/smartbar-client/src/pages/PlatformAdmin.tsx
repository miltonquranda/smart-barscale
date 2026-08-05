import { useEffect, useState } from 'react';
import api from '../api';

const emptyForm = { businessName: '', zipCode: '', firstName: '', lastName: '', email: '', password: '' };

const PlatformAdmin = () => {
  const [businesses, setBusinesses] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const [businessResponse, deviceResponse] = await Promise.all([api.get('/platform/businesses'), api.get('/devices')]);
      setBusinesses(businessResponse.data);
      setDevices(deviceResponse.data.filter((device: any) => !device.business || device.status === 'unassigned'));
    } catch (err: any) { setMessage(err?.response?.data?.error || 'Unable to load platform data.'); }
  };

  useEffect(() => { load(); }, []);

  const onboard = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/platform/businesses', form);
      setForm(emptyForm); setShowForm(false); setMessage('Business and owner created.'); await load();
    } catch (err: any) { setMessage(err?.response?.data?.error || 'Unable to create business.'); }
  };

  const updateStatus = async (id: string, status: string) => {
    try { await api.patch(`/platform/businesses/${id}/status`, { status }); await load(); setMessage(`Business ${status}.`); }
    catch (err: any) { setMessage(err?.response?.data?.error || 'Unable to update business.'); }
  };

  const assignDevice = async (deviceId: string, businessId: string) => {
    try { await api.patch(`/platform/devices/${deviceId}/assign`, { businessId }); await load(); setMessage('Device assigned.'); }
    catch (err: any) { setMessage(err?.response?.data?.error || 'Unable to assign device.'); }
  };

  return <div className="platform-page">
    <div className="platform-header">
      <div><span className="eyebrow">PLATFORM ADMINISTRATION</span><h1>Business operations</h1><p>Provision customers, manage access, and keep devices assigned to the right business.</p></div>
      <button className="primary-action" onClick={() => setShowForm(value => !value)}>{showForm ? 'Close' : '+ Add business'}</button>
    </div>
    {message && <div className="platform-notice">{message}</div>}
    {showForm && <form className="platform-card onboarding-form" onSubmit={onboard}>
      <div><h2>Onboard a business</h2><p>Create the first location and business admin account.</p></div>
      <div className="form-grid">
        {([['businessName', 'Business name'], ['zipCode', 'ZIP / postal code'], ['firstName', 'Admin first name'], ['lastName', 'Admin last name'], ['email', 'Admin email'], ['password', 'Temporary password']] as const).map(([key, label]) => <label key={key}>{label}<input required={key !== 'zipCode'} type={key === 'email' ? 'email' : key === 'password' ? 'password' : 'text'} value={form[key]} onChange={event => setForm({ ...form, [key]: event.target.value })} /></label>)}
      </div>
      <button className="primary-action" type="submit">Create business</button>
    </form>}
    <section className="platform-card"><div className="section-heading"><div><h2>Businesses</h2><span>{businesses.length} accounts</span></div></div>
      <div className="business-list">{businesses.map(business => <div className="business-row" key={business._id}><div><strong>{business.name}</strong><small>{business.zipCode || 'No location details'} · {business.user_count} users · {business.device_count} devices</small></div><div className="row-actions"><span className={`status-pill ${business.status}`}>{business.status}</span>{business.status === 'active' ? <button onClick={() => updateStatus(business._id, 'suspended')}>Suspend</button> : <button onClick={() => updateStatus(business._id, 'active')}>Reactivate</button>}{business.status !== 'offboarded' && <button className="danger-action" onClick={() => updateStatus(business._id, 'offboarded')}>Offboard</button>}</div></div>)}</div>
    </section>
    <section className="platform-card"><div className="section-heading"><div><h2>Unassigned devices</h2><span>Assign a scale to a business</span></div></div>
      <div className="business-list">{devices.length === 0 ? <p className="empty-state">All devices are assigned.</p> : devices.map(device => <div className="business-row" key={device._id}><div><strong>{device.serialNumber || device._id}</strong><small>{device.type || 'scan-scale'} · {device.status || 'available'}</small></div><select defaultValue="" onChange={event => event.target.value && assignDevice(device._id, event.target.value)}><option value="">Assign to…</option>{businesses.filter(b => b.status === 'active').map(b => <option key={b._id} value={b._id}>{b.name}</option>)}</select></div>)}</div>
    </section>
  </div>;
};

export default PlatformAdmin;
