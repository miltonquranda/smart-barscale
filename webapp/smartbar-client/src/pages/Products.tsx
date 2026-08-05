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
    // Inventory specs. The scale reports grams; these are what turn grams into
    // millilitres and dollars. Without all three of full weight, empty weight
    // and volume, every derived figure on the dashboard is zero.
    bottle_full_weight_g: string;
    bottle_empty_weight_g: string;
    bottle_volume_ml: string;
    cost_per_bottle: string;
    par_level: string;
    pour_price: string;
    pour_volume_ml: string;
}

const emptyForm: ProductForm = {
    name: '', brand: '', description: '', category: '',
    image_url: '', quantity: '', weight: '',
    country_of_origin: '', ingredients: '',
    bottle_full_weight_g: '', bottle_empty_weight_g: '', bottle_volume_ml: '',
    cost_per_bottle: '', par_level: '', pour_price: '', pour_volume_ml: '',
};

const numOrEmpty = (v: any) => (v === null || v === undefined || v === '' ? '' : String(v));

const Products = () => {
    const PAGE_SIZE = 25;
    const [products, setProducts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [pageCursors, setPageCursors] = useState<(string | null)[]>([null]);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [totalProducts, setTotalProducts] = useState<number | null>(null);
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

    useEffect(() => { fetchCategories(); fetchProductCount(); }, []);
    useEffect(() => { fetchProducts(); }, [page]);

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

    // Products persist the category document ID. Resolve it for display while
    // also accepting older records that stored a path or name directly.
    const categoryLabel = (value: any): string => {
        if (!value) return '—';
        if (typeof value === 'object') return value.path || value.name || value._id || '—';
        const category = categories.find(c => c._id === value || c.path === value || c.name === value);
        return category?.path || category?.name || String(value);
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
        setLoading(true);
        try {
            const cursor = pageCursors[page];
            const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
            if (cursor) query.set('cursor', cursor);
            const resp = await api.get(`/bottles/page?${query.toString()}`);
            setProducts(resp.data.products || []);
            setHasNextPage(Boolean(resp.data.hasMore));
        } catch (err) {
            console.error('Failed to fetch products', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchProductCount = async () => {
        try {
            const resp = await api.get('/bottles/count');
            const count = typeof resp.data === 'number' ? resp.data : resp.data.count;
            if (Number.isFinite(Number(count))) setTotalProducts(Number(count));
        } catch (err) {
            console.error('Failed to fetch product count', err);
        }
    };

    const goToNextPage = () => {
        if (!hasNextPage) return;
        setPageCursors(prev => [...prev, null]);
        setPage(page + 1);
    };

    const goToPreviousPage = () => {
        if (page === 0) return;
        setPage(page - 1);
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
            bottle_full_weight_g: numOrEmpty(data.bottle_full_weight_g),
            bottle_empty_weight_g: numOrEmpty(data.bottle_empty_weight_g),
            bottle_volume_ml: numOrEmpty(data.bottle_volume_ml),
            cost_per_bottle: numOrEmpty(data.cost_per_bottle),
            par_level: numOrEmpty(data.par_level),
            pour_price: numOrEmpty(data.pour_price),
            pour_volume_ml: numOrEmpty(data.pour_volume_ml),
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
            // Numeric specs go over the wire as numbers, not strings. An empty
            // field means "not set" and is sent as null so the API can tell it
            // apart from a deliberate zero.
            const numericFields = [
                'bottle_full_weight_g', 'bottle_empty_weight_g', 'bottle_volume_ml',
                'cost_per_bottle', 'par_level', 'pour_price', 'pour_volume_ml',
            ] as const;
            const payload: any = { ...form };
            numericFields.forEach(key => {
                payload[key] = form[key] === '' ? null : Number(form[key]);
            });

            const full = payload.bottle_full_weight_g;
            const empty = payload.bottle_empty_weight_g;
            if (full !== null && empty !== null && full <= empty) {
                setSaveMsg('Full bottle weight must be greater than empty bottle weight.');
                setSaving(false);
                return;
            }

            const resp = await api.put(`/product/${editBarcode.trim()}`, payload);
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

                            {/* ── Inventory specs ─────────────────────────────
                                These drive every number on the dashboard. The
                                scale reports grams; without full weight, empty
                                weight and volume there is no way to convert a
                                reading into millilitres, so on-hand value,
                                consumption and pour cost all come out zero. */}
                            <div style={{ gridColumn: '1 / -1', marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                                <h3 style={{ margin: '0 0 4px', fontSize: 15, color: 'var(--color-text)' }}>Inventory & pricing specs</h3>
                                <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                    Required for inventory tracking. Weigh one full bottle and one empty bottle of this product
                                    on the scale to get accurate figures — printed volumes alone aren't enough.
                                </p>
                                <SpecCompleteness form={form} />
                            </div>

                            <div>
                                <label style={labelStyle}>Full bottle weight (g) *</label>
                                <input type="number" min="0" step="1" value={form.bottle_full_weight_g}
                                    onChange={e => setForm({ ...form, bottle_full_weight_g: e.target.value })}
                                    placeholder="e.g. 1250" style={inputStyle} />
                                <FieldHint text="Unopened bottle on the scale, including glass." />
                            </div>
                            <div>
                                <label style={labelStyle}>Empty bottle weight (g) *</label>
                                <input type="number" min="0" step="1" value={form.bottle_empty_weight_g}
                                    onChange={e => setForm({ ...form, bottle_empty_weight_g: e.target.value })}
                                    placeholder="e.g. 500" style={inputStyle} />
                                <FieldHint text="Same bottle, fully drained. Varies a lot by bottle shape." />
                            </div>
                            <div>
                                <label style={labelStyle}>Bottle volume (ml) *</label>
                                <input type="number" min="0" step="1" value={form.bottle_volume_ml}
                                    onChange={e => setForm({ ...form, bottle_volume_ml: e.target.value })}
                                    placeholder="e.g. 750" style={inputStyle} />
                                <FieldHint text="Liquid capacity, not the bottle's total size." />
                            </div>
                            <div>
                                <label style={labelStyle}>Cost per bottle ($)</label>
                                <input type="number" min="0" step="0.01" value={form.cost_per_bottle}
                                    onChange={e => setForm({ ...form, cost_per_bottle: e.target.value })}
                                    placeholder="e.g. 24.50" style={inputStyle} />
                                <FieldHint text="What you pay your supplier. Drives inventory value and pour cost." />
                            </div>
                            <div>
                                <label style={labelStyle}>Pour price ($)</label>
                                <input type="number" min="0" step="0.01" value={form.pour_price}
                                    onChange={e => setForm({ ...form, pour_price: e.target.value })}
                                    placeholder="e.g. 12.00" style={inputStyle} />
                                <FieldHint text="Menu price for one pour. Without it, revenue and pour cost are excluded." />
                            </div>
                            <div>
                                <label style={labelStyle}>Pour size (ml)</label>
                                <input type="number" min="0" step="1" value={form.pour_volume_ml}
                                    onChange={e => setForm({ ...form, pour_volume_ml: e.target.value })}
                                    placeholder="e.g. 45" style={inputStyle} />
                                <FieldHint text="Standard measure. A US 1.5oz shot is about 44ml." />
                            </div>
                            <div>
                                <label style={labelStyle}>Par level (bottles)</label>
                                <input type="number" min="0" step="1" value={form.par_level}
                                    onChange={e => setForm({ ...form, par_level: e.target.value })}
                                    placeholder="e.g. 6" style={inputStyle} />
                                <FieldHint text="Target stock level, used for reorder prompts." />
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <SpecPreview form={form} />
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
                <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>
                    All Products ({totalProducts === null ? products.length : totalProducts})
                </h3>
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
                                            <td style={tdStyle}>{categoryLabel(p.category_name || p.category)}</td>
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
                {!loading && (page > 0 || hasNextPage) && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                        <button onClick={goToPreviousPage} disabled={page === 0}
                            style={{ ...btnStyle('#6c757d'), opacity: page === 0 ? 0.5 : 1 }}>
                            Previous
                        </button>
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
                            Page {page + 1} · Showing {products.length} products
                        </span>
                        <button onClick={goToNextPage} disabled={!hasNextPage}
                            style={{ ...btnStyle('#007bff'), opacity: hasNextPage ? 1 : 0.5 }}>
                            Next
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Spec helpers ────────────────────────────────────────────────────────────

const FieldHint = ({ text }: { text: string }) => (
    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3, lineHeight: 1.4 }}>{text}</div>
);

/** Traffic-light summary of which capabilities the entered specs unlock. */
const SpecCompleteness = ({ form }: { form: any }) => {
    const num = (v: string) => (v === '' ? null : Number(v));
    const hasTracking = !!(num(form.bottle_full_weight_g) && num(form.bottle_empty_weight_g) && num(form.bottle_volume_ml));
    const hasValue = hasTracking && !!num(form.cost_per_bottle);
    const hasRevenue = hasValue && !!num(form.pour_price) && !!num(form.pour_volume_ml);

    const items = [
        { ok: hasTracking, label: 'Volume tracking', need: 'needs full + empty weight and volume' },
        { ok: hasValue, label: 'Inventory value', need: 'also needs cost per bottle' },
        { ok: hasRevenue, label: 'Revenue & pour cost', need: 'also needs pour price and size' },
    ];

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {items.map(item => (
                <span key={item.label} title={item.ok ? 'Enabled' : item.need} style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 12,
                    backgroundColor: item.ok ? '#28a74518' : '#6c757d18',
                    color: item.ok ? '#28a745' : 'var(--color-text-muted)',
                    border: `1px solid ${item.ok ? '#28a74540' : 'var(--color-border)'}`,
                }}>
                    {item.ok ? '✓' : '○'} {item.label}
                </span>
            ))}
        </div>
    );
};

/**
 * Shows what the entered specs imply, so a typo is obvious before saving.
 * A transposed empty weight or a volume in the wrong unit produces a pour cost
 * that is visibly absurd here, rather than quietly wrong on the dashboard.
 */
const SpecPreview = ({ form }: { form: any }) => {
    const num = (v: string) => (v === '' ? NaN : Number(v));
    const full = num(form.bottle_full_weight_g);
    const empty = num(form.bottle_empty_weight_g);
    const volume = num(form.bottle_volume_ml);
    const cost = num(form.cost_per_bottle);
    const pourPrice = num(form.pour_price);
    const pourVol = num(form.pour_volume_ml);

    if (!Number.isFinite(full) || !Number.isFinite(empty) || !Number.isFinite(volume) || volume <= 0) return null;
    if (full <= empty) {
        return (
            <div style={{ ...previewBox, borderColor: '#dc354540', backgroundColor: '#dc354510', color: '#dc3545' }}>
                Full bottle weight must be greater than empty bottle weight — check those two figures.
            </div>
        );
    }

    const liquidWeight = full - empty;
    const density = liquidWeight / volume;
    const rows: string[] = [
        `Liquid weighs ${liquidWeight}g at ${volume}ml → ${density.toFixed(2)} g/ml`,
    ];
    if (Number.isFinite(cost) && cost > 0) {
        rows.push(`Cost per ml: $${(cost / volume).toFixed(4)}`);
        if (Number.isFinite(pourPrice) && Number.isFinite(pourVol) && pourVol > 0 && pourPrice > 0) {
            const pourCost = ((cost / volume) * pourVol / pourPrice) * 100;
            rows.push(`One ${pourVol}ml pour costs $${((cost / volume) * pourVol).toFixed(2)} and sells for $${pourPrice.toFixed(2)} → ${pourCost.toFixed(1)}% pour cost`);
            rows.push(`${Math.floor(volume / pourVol)} pours per bottle`);
        }
    }

    // Spirits sit near 0.94 g/ml, water at 1.0. Well outside that range almost
    // always means a unit mix-up rather than an unusual product.
    const suspect = density < 0.6 || density > 1.5;

    return (
        <div style={{ ...previewBox, ...(suspect ? { borderColor: '#f0ad4e40', backgroundColor: '#f0ad4e10' } : {}) }}>
            <strong style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>Check these figures look right</strong>
            {rows.map(r => <div key={r} style={{ fontSize: 12, lineHeight: 1.7 }}>{r}</div>)}
            {suspect && (
                <div style={{ fontSize: 12, color: '#f0ad4e', marginTop: 6 }}>
                    That density is unusual — most spirits are around 0.94 g/ml. Check the weights are in grams and the volume in millilitres.
                </div>
            )}
        </div>
    );
};

const previewBox: React.CSSProperties = {
    marginTop: 12, padding: '10px 14px', borderRadius: 6,
    border: '1px solid var(--color-border)', backgroundColor: 'var(--color-bg)',
    color: 'var(--color-text-muted)',
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
