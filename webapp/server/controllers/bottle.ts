import { db } from '../firebase';
import BaseCtrl from './base';

export default class BottleCtrl extends BaseCtrl {
  collectionName = 'bottles';

  getAllInBusiness = async (req, res) => {
    try {
      const canAccessBusiness = req.user.business.some(
        biz => "" + biz._id === req.params.businessId
      );
      if (canAccessBusiness) {
        const snapshot = await db.collection('bottle-stats')
          .where('business', '==', req.params.businessId)
          .get();

        const bottleIds = new Set();
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data.bottle) bottleIds.add(data.bottle);
        });

        const bottles = {};
        await Promise.all(Array.from(bottleIds).map(async (id: string) => {
          const bDoc = await db.collection('bottles').doc(id).get();
          if (bDoc.exists) {
            bottles[bDoc.id] = { _id: bDoc.id, ...bDoc.data() };
          }
        }));

        res.status(200).json(bottles);
      } else {
        res.status(400).json({ message: "not authorized to access that resource" });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };
}
