import { Business } from './business.model';

export class BottleStat {
  _id?: string;
  barcode?: string;
  weight?: string;
  date?: string;
  bottle?: any;
  business: Business[] | string | string[];
  __v?: number;
}
