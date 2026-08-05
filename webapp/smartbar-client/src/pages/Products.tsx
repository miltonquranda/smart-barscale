import React, { useEffect, useState } from 'react';
import api from '../api';

interface ProductForm {
    name: string;
    brand: string;
    description: string;
    category: string;
    image_url: string;
    quantity: string;
    weight: string;
    country_of_origin: string;
    ingredients: string;
}

const emptyForm: ProductForm = {
    name: '', brand: '', description: '', category: '',
    image_url: '', quantity: '', weight: '',
    country_of_origin: '', ingredients: '',
};

const Products = () => {
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [barcodeLookup, setBarcodeLookup] = useState('');
    const [lookupLoading, setLookupLoading] = useState(false);
    const [lookupResult, setLookupResult] = useState<any>(null);
    const [lookupError, setLookupError] = useState('');

    const [editBarcode, setEditBarcode] = useState('');
    const [form, setForm] = useState<ProductForm>({ ...emptyForm });
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState('');
    const [imageUploading, setImageUploading] = useState(false);
    const [categories, setCategories] = useState<any[]>([]);
    const [showAddCat, setShowAddCat] = useState(false);
    const [newCatName, setNewCatName] = useState('');
    const [newCatParent, setNewCatParent] = useState('');
    const [addingCat, setAddingCat] = useState(false);

    useEffect(() => { fetchProducts(); fetchCategories(); }, []);

    const fetchCategories = async () => {
        try {
            const resp = await api.get('/categories');
            setCategories(resp.data);
        } catch (_) {}
    };

    const getCategoryOptions = (): { value: string; label: string; indent: number }[] => {
        const opts: { value: string; label: string; indent: number }[] = [];
        const buildOpts = (parentId: string | null, depth: number) => {
            categories
                .filter(c => c.parent === parentId)
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(c => {
                    opts.push({ value: c.path, label: c.name, indent: depth });
                    buildOpts(c._id, depth + 1);
                });
        };
        buildOpts(null, 0);
        return opts;
    };

    const handleAddCategory = async () => {
        if (!newCatName.trim()) return;
        setAddingCat(true);
        try {
            const body: any = { name: newCatName.trim() };
            if (newCatParent) body.parent = newCatParent;
            const resp = await api.post('/category', body);
            const created = resp.data;
            setCategories(prev => [...prev, created]);
            setForm(prev => ({ ...prev, category: created.path }));
            setNewCatName('');
            setNewCatParent('');
            setShowAddCat(false);
        } catch (err: any) {
            alert(err.response?.data?.error || 'Failed to create category');
        } finally {
            setAddingCat(false);
        }
    };

    const fetchProducts = async () => {
        try {
            const resp = await api.get('/bottles');
            setProducts(resp.data);
        } catch (err) {
            console.error('Failed to fetch products', err);
        } finally {
            setLoading(false);
        }
    };

    const handleLookup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!barcodeLookup.trim()) return;
        setLookupLoading(true);
        setLookupError('');
        setLookupResult(null);

        try {
            const resp = await api.get(`/product/${barcodeLookup.trim()}`);
            setLookupResult(resp.data);
            populateForm(resp.data);
        } catch (err: any) {
            if (err.response?.status === 404) {
                setLookupError('Product not found. You can add it below.');
                setEditBarcode(barcodeLookup.trim());
                setForm({ ...emptyForm });
            } else {
                setLookupError('Lookup failed: ' + (err.response?.data?.error || err.message));
            }
        } finally {
            setLookupLoading(false);
        }
    };

    const populateForm = (data: any) => {
        setEditBarcode(data.barcode || barcodeLookup.trim());
        setForm({
            name: data.name || '',
            brand: data.brand || '',
            description: data.description || '',
            category: data.category || '',
            image_url: data.image_url || '',
            quantity: data.quantity || '',
            weight: data.weight || '',
            country_of_origin: data.country_of_origin || '',
            ingredients: data.ingredients || '',
        });
    };

    const handleEditClick = (product: any) => {
        setBarcodeLookup(product.barcode || '');
        setLookupResult(product);
        populateForm(product);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editBarcode.trim()) return;
        if (!form.name.trim()) { setSaveMsg('Product name is required'); return; }

        setSaving(true);
        setSaveMsg('');
        try {
            const resp = await api.put(`/product/${editBarcode.trim()}`, form);
            setSaveMsg(resp.data.created ? 'Product created!' : 'Product updated!');
            setLookupResult(resp.data);
            fetchProducts();
        } catch (err: any) {
            setSaveMsg('Save failed: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaving(false);
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !editBarcode) return;

        setImageUploading(true);
        try {
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = (reader.result as string).split(',')[1];
                const resp = await api.post(`/product/${editBarcode}/image`, {
                    image: base64,
                    contentType: file.type || 'image/jpeg',
                });
                setForm(prev => ({ ...prev, image_url: resp.data.image_url }));
                setImageUploading(false);
            };
            reader.readAsDataURL(file);
        } catch (err: any) {
            console.error('Image upload failed', err);
            setImageUploading(false);
        }
    };

    const handleClear = () => {
        setBarcodeLookup('');
        setEditBarcode('');
        setForm({ ...emptyForm });
        setLookupResult(null);
        setLookupError('');
        setSaveMsg('');
    };

    const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box' };

    return (
        <div style={{ padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
            <h1 style={{ color: 'var(--color-text)' }}>Product Database</h1>

            {/* Barcode lookup */}
            <div style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Lookup / Add Product</h3>
                <form onSubmit={handleLookup} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Barcode</label>
                        <input
                            type="text"
                            value={barcodeLookup}
                            onChange={e => setBarcodeLookup(e.target.value)}
                            placeholder="Enter barcode to search or add"
                            style={inputStyle}
                        />
                    </div>
                    <button type="submit" disabled={lookupLoading} style={btnStyle('#007bff')}>
                        {lookupLoading ? 'Searching...' : 'Search'}
                    </button>
                    <button type="button" onClick={handleClear} style={btnStyle('#6c757d')}>Clear</button>
                </form>

                {lookupError && <p style={{ color: '#f0ad4e', fontSize: 14 }}>{lookupError}</p>}
                {lookupResult && !lookupError && (
                    <p style={{ color: '#5cb85c', fontSize: 14 }}>
                        Found: <strong>{lookupResult.name}</strong> (source: {lookupResult.source || 'unknown'})
                    </p>
                )}
            </div>

            {/* Product form */}
            {editBarcode && (
                <div style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                    <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>
                        {lookupResult ? 'Edit' : 'Add'} Product — <code>{editBarcode}</code>
                    </h3>
                    <form onSubmit={handleSave}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Product Name *</label>
                                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required style={inputStyle} />
                            </div>
                            <div>
                                <label style={labelStyle}>Brand</label>
                                <input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} style={inputStyle} />
                            </div>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <label style={{ ...labelStyle, marginBottom: 0 }}>Category</label>
                                    <button type="button" onClick={() => setShowAddCat(!showAddCat)}
                                        style={{ background: 'none', border: 'none', color: '#007bff', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                                        {showAddCat ? '✕ Cancel' : '+ New'}
                                    </button>
                                </div>
                                <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                                    style={{ ...inputStyle, appearance: 'auto' }}>
                                    <option value="">Select category...</option>
                                    {getCategoryOptions().map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {'─'.repeat(opt.indent)} {opt.label}
                                        </option>
                                    ))}
                                </select>
                                {form.category && (
                                    <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-muted)' }}>
                                        {form.category}
                                    </div>
                                )}
                                {showAddCat && (
                                    <div style={{ marginTop: 8, padding: 12, border: '1px solid var(--color-border)', borderRadius: 6, backgroundColor: 'var(--color-bg)' }}>
                                        <div style={{ marginBottom: 8 }}>
                                            <label style={{ fontSize: 12, color: 'var(--color-text-muted)', display: 'block', marginBottom: 2 }}>Parent (optional)</label>
                                            <select value={newCatParent} onChange={e => setNewCatParent(e.target.value)}
                                                style={{ ...inputStyle, appearance: 'auto', fontSize: 13 }}>
                                                <option value="">None (top-level)</option>
                                                {getCategoryOptions().filter(o => o.indent < 4).map(opt => (
                                                    <option key={opt.value} value={categories.find(c => c.path === opt.value)?._id || ''}>
                                                        {'─'.repeat(opt.indent)} {opt.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                                                placeholder="Category name" style={{ ...inputStyle, flex: 1, fontSize: 13 }}
                                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddCategory(); } }} />
                                            <button type="button" onClick={handleAddCategory} disabled={addingCat || !newCatName.trim()}
                                                style={{ ...btnStyle(addingCat ? '#999' : '#28a745'), fontSize: 13, padding: '4px 12px' }}>
                                                {addingCat ? '...' : 'Add'}
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Description</label>
                                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                            </div>
                            <div>
                                <label style={labelStyle}>Quantity</label>
                                <input value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="e.g. 330ml" style={inputStyle} />
                            </div>
                            <div>
                                <label style={labelStyle}>Weight</label>
                                <input value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value })} placeholder="e.g. 500g" style={inputStyle} />
                            </div>
                            <div>
                                <label style={labelStyle}>Country of Origin</label>
                                <input value={form.country_of_origin} onChange={e => setForm({ ...form, country_of_origin: e.target.value })} style={inputStyle} />
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Product Image</label>
                                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: 8 }}>
                                    <label style={{
                                        ...btnStyle(imageUploading ? '#999' : '#28a745'),
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        cursor: imageUploading ? 'not-allowed' : 'pointer',
                                    }}>
                                        {imageUploading ? 'Uploading...' : '📷 Upload Image'}
                                        <input type="file" accept="image/*" capture="environment"
                                            onChange={handleImageUpload} disabled={imageUploading}
                                            style={{ display: 'none' }} />
                                    </label>
                                    <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>or enter URL below</span>
                                </div>
                                <input value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })}
                                    placeholder="https://..." style={inputStyle} />
                                {form.image_url && (
                                    <div style={{ marginTop: 8, textAlign: 'center' }}>
                                        <img src={form.image_url} alt="Preview"
                                            style={{ maxHeight: 140, borderRadius: 8, border: '1px solid var(--color-border)' }}
                                            onError={e => (e.currentTarget.style.display = 'none')} />
                                    </div>
                                )}
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Ingredients</label>
                                <textarea value={form.ingredients} onChange={e => setForm({ ...form, ingredients: e.target.value })} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
                            </div>
                        </div>

                        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                            <button type="submit" disabled={saving} style={btnStyle('#007bff')}>
                                {saving ? 'Saving...' : 'Save Product'}
                            </button>
                            {saveMsg && <span style={{ fontSize: 14, color: saveMsg.startsWith('Save failed') ? '#d9534f' : '#5cb85c' }}>{saveMsg}</span>}
                        </div>
                    </form>
                </div>
            )}

            {/* Product list */}
            <div style={{ padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>All Products ({products.length})</h3>
                {loading ? <p>Loading...</p> : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                                    <th style={thStyle}>Barcode</th>
                                    <th style={thStyle}>Name</th>
                                    <th style={thStyle}>Brand</th>
                                    <th style={thStyle}>Category</th>
                                    <th style={thStyle}>Source</th>
                                    <th style={thStyle}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {products.length === 0 ? (
                                    <tr><td colSpan={6} style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>No products in database.</td></tr>
                                ) : (
                                    products.map((p: any) => (
                                        <tr key={p._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={tdStyle}><code>{p.barcode}</code></td>
                                            <td style={tdStyle}>{p.name || '—'}</td>
                                            <td style={tdStyle}>{p.brand || '—'}</td>
                                            <td style={tdStyle}>{p.category || '—'}</td>
                                            <td style={tdStyle}>
                                                <span style={{
                                                    fontSize: 11, padding: '2px 8px', borderRadius: 10,
                                                    backgroundColor: p.source === 'manual' ? '#5bc0de33' : p.source === 'openfoodfacts' ? '#5cb85c33' : '#f0ad4e33',
                                                    color: p.source === 'manual' ? '#5bc0de' : p.source === 'openfoodfacts' ? '#5cb85c' : '#f0ad4e',
                                                }}>
                                                    {p.source || 'unknown'}
                                                </span>
                                            </td>
                                            <td style={tdStyle}>
                                                <button onClick={() => handleEditClick(p)} style={{ ...btnStyle('#6c757d'), padding: '4px 12px', fontSize: 12 }}>
                                                    Edit
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

const btnStyle = (bg: string): React.CSSProperties => ({
    padding: '0.5rem 1rem', backgroundColor: bg, color: 'white',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14,
});

const labelStyle: React.CSSProperties = {
    display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-muted)',
};

const thStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)' };
const tdStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)' };

export default Products;
