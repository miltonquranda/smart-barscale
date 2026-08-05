import { db } from '../firebase';

const COLLECTION = 'categories';
const MAX_DEPTH = 5;

export default class CategoryCtrl {

  getAll = async (_req, res) => {
    try {
      const snapshot = await db.collection(COLLECTION).orderBy('path').get();
      const docs = snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() }));
      res.status(200).json(docs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  getTree = async (_req, res) => {
    try {
      const snapshot = await db.collection(COLLECTION).orderBy('name').get();
      const all = snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() } as any));

      const byId: Record<string, any> = {};
      for (const c of all) { byId[c._id] = { ...c, children: [] }; }

      const roots: any[] = [];
      for (const c of Object.values(byId)) {
        if (c.parent && byId[c.parent]) {
          byId[c.parent].children.push(c);
        } else {
          roots.push(c);
        }
      }

      res.status(200).json(roots);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  insert = async (req, res) => {
    try {
      const { name, parent } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });

      let level = 1;
      let path = name.trim();

      if (parent) {
        const parentDoc = await db.collection(COLLECTION).doc(parent).get();
        if (!parentDoc.exists) return res.status(400).json({ error: 'Parent category not found' });
        const parentData = parentDoc.data()!;
        level = (parentData.level || 1) + 1;
        if (level > MAX_DEPTH) return res.status(400).json({ error: `Maximum category depth is ${MAX_DEPTH}` });
        path = `${parentData.path} > ${name.trim()}`;
      }

      // Check for duplicate name under same parent
      let query = db.collection(COLLECTION).where('name', '==', name.trim());
      if (parent) {
        query = query.where('parent', '==', parent);
      } else {
        query = query.where('parent', '==', null);
      }
      const existing = await query.get();
      if (!existing.empty) return res.status(409).json({ error: 'Category already exists at this level' });

      const data = { name: name.trim(), parent: parent || null, level, path };
      const ref = await db.collection(COLLECTION).add(data);
      res.status(201).json({ _id: ref.id, ...data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  update = async (req, res) => {
    try {
      const { id } = req.params;
      const { name } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Category name is required' });

      const doc = await db.collection(COLLECTION).doc(id).get();
      if (!doc.exists) return res.status(404).json({ error: 'Category not found' });

      const oldData = doc.data()!;
      const oldPath = oldData.path as string;

      let newPath: string;
      if (oldData.parent) {
        const parentDoc = await db.collection(COLLECTION).doc(oldData.parent).get();
        newPath = parentDoc.exists ? `${parentDoc.data()!.path} > ${name.trim()}` : name.trim();
      } else {
        newPath = name.trim();
      }

      await db.collection(COLLECTION).doc(id).update({ name: name.trim(), path: newPath });

      // Update paths of all descendants
      const descendants = await db.collection(COLLECTION)
        .where('path', '>=', oldPath + ' > ')
        .where('path', '<=', oldPath + ' > \uf8ff')
        .get();

      const batch = db.batch();
      for (const d of descendants.docs) {
        const dPath = d.data().path as string;
        const updated = newPath + dPath.substring(oldPath.length);
        batch.update(d.ref, { path: updated });
      }
      if (!descendants.empty) await batch.commit();

      res.status(200).json({ _id: id, name: name.trim(), path: newPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };

  delete = async (req, res) => {
    try {
      const { id } = req.params;

      // Check for children
      const children = await db.collection(COLLECTION).where('parent', '==', id).limit(1).get();
      if (!children.empty) {
        return res.status(400).json({ error: 'Cannot delete category with subcategories. Delete children first.' });
      }

      await db.collection(COLLECTION).doc(id).delete();
      res.sendStatus(200);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}
