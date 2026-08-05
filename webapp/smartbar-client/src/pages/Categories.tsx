import React, { useEffect, useState } from 'react';
import api from '../api';

interface Category {
    _id: string;
    name: string;
    parent: string | null;
    level: number;
    path: string;
    children?: Category[];
}

const Categories = () => {
    const [tree, setTree] = useState<Category[]>([]);
    const [loading, setLoading] = useState(true);
    const [newName, setNewName] = useState('');
    const [selectedParent, setSelectedParent] = useState<string | null>(null);
    const [selectedParentPath, setSelectedParentPath] = useState('');
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [flatList, setFlatList] = useState<Category[]>([]);

    useEffect(() => { fetchCategories(); }, []);

    const fetchCategories = async () => {
        try {
            const [treeResp, flatResp] = await Promise.all([
                api.get('/categories/tree'),
                api.get('/categories'),
            ]);
            setTree(treeResp.data);
            setFlatList(flatResp.data);
        } catch (err) {
            console.error('Failed to fetch categories', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newName.trim()) return;
        setSaving(true);
        setMsg('');
        try {
            await api.post('/category', { name: newName.trim(), parent: selectedParent });
            setNewName('');
            setMsg('Category created!');
            fetchCategories();
        } catch (err: any) {
            setMsg('Error: ' + (err.response?.data?.error || err.message));
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id: string, name: string) => {
        if (!confirm(`Delete "${name}"?`)) return;
        try {
            await api.delete(`/category/${id}`);
            fetchCategories();
        } catch (err: any) {
            alert(err.response?.data?.error || 'Delete failed');
        }
    };

    const selectParent = (id: string | null, path: string) => {
        setSelectedParent(id);
        setSelectedParentPath(path);
    };

    const renderTree = (nodes: Category[], depth = 0): React.ReactNode => {
        return nodes.map(node => (
            <React.Fragment key={node._id}>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ ...tdStyle, paddingLeft: `${depth * 24 + 8}px` }}>
                        {depth > 0 && <span style={{ color: 'var(--color-text-muted)', marginRight: 4 }}>{'└─ '}</span>}
                        <strong>{node.name}</strong>
                    </td>
                    <td style={tdStyle}>
                        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{node.path}</span>
                    </td>
                    <td style={tdStyle}>
                        <span style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 10,
                            backgroundColor: '#5bc0de33', color: '#5bc0de',
                        }}>L{node.level}</span>
                    </td>
                    <td style={tdStyle}>
                        {(node.level || 1) < 5 && (
                            <button onClick={() => selectParent(node._id, node.path)}
                                style={{ ...btnSmall, backgroundColor: '#5cb85c', marginRight: 4 }}>
                                + Sub
                            </button>
                        )}
                        <button onClick={() => handleDelete(node._id, node.name)}
                            style={{ ...btnSmall, backgroundColor: '#d9534f' }}>
                            Del
                        </button>
                    </td>
                </tr>
                {node.children && node.children.length > 0 && renderTree(node.children, depth + 1)}
            </React.Fragment>
        ));
    };

    return (
        <div style={{ padding: '2rem', maxWidth: 960, margin: '0 auto' }}>
            <h1 style={{ color: 'var(--color-text)' }}>Categories</h1>

            {/* Add category form */}
            <div style={{ marginBottom: '2rem', padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Add Category</h3>
                {selectedParent && (
                    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
                            Adding under: <strong style={{ color: 'var(--color-text)' }}>{selectedParentPath}</strong>
                        </span>
                        <button onClick={() => selectParent(null, '')}
                            style={{ ...btnSmall, backgroundColor: '#6c757d' }}>
                            Clear
                        </button>
                    </div>
                )}
                <form onSubmit={handleAdd} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--color-text-muted)' }}>
                            {selectedParent ? 'Subcategory Name' : 'Top-level Category Name'}
                        </label>
                        <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                            placeholder="e.g. Beverages" required
                            style={{ width: '100%', boxSizing: 'border-box' }} />
                    </div>
                    <button type="submit" disabled={saving} style={btnStyle('#007bff')}>
                        {saving ? 'Adding...' : 'Add'}
                    </button>
                </form>
                {msg && <p style={{ fontSize: 13, marginTop: 8, color: msg.startsWith('Error') ? '#d9534f' : '#5cb85c' }}>{msg}</p>}
            </div>

            {/* Category tree */}
            <div style={{ padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 8, backgroundColor: 'var(--color-surface)' }}>
                <h3 style={{ color: 'var(--color-text)', marginTop: 0 }}>Category Tree ({flatList.length} total)</h3>
                {loading ? <p>Loading...</p> : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                                <th style={thStyle}>Name</th>
                                <th style={thStyle}>Full Path</th>
                                <th style={thStyle}>Level</th>
                                <th style={thStyle}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tree.length === 0
                                ? <tr><td colSpan={4} style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>No categories yet.</td></tr>
                                : renderTree(tree)
                            }
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

const btnStyle = (bg: string): React.CSSProperties => ({
    padding: '0.5rem 1rem', backgroundColor: bg, color: 'white',
    border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14,
});
const btnSmall: React.CSSProperties = {
    padding: '3px 10px', color: 'white', border: 'none',
    borderRadius: 4, cursor: 'pointer', fontSize: 12,
};
const thStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)' };
const tdStyle: React.CSSProperties = { padding: '0.5rem', color: 'var(--color-text)' };

export default Categories;
