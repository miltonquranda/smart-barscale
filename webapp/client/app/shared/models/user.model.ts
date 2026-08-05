import { Business } from "./business.model";

export class User {
  _id?: string;
  firstName: string;
  lastName: string;
  username: string;
  password?: string;
  email?: string;
  role?: string;
  business?: Business[];
  token?: any;
  customer_id?: any;
}
