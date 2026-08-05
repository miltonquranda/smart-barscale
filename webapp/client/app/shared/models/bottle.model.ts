export class Bottle {
  _id?: string;
  barcode?: number;
  name?: string;
  brand?: string;
}

export interface NormalizedBottles { [key: string]: Bottle; };
