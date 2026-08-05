import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Business } from '../shared/models/business.model';
import { environment } from '../../environments/environment';

@Injectable()
export class BusinessService {

  constructor(private http: HttpClient) { }

  getBusinesses(): Observable<Business[]> {
    return this.http.get<Business[]>(`${environment.apiUrl}/businesses`);
  }

  countBusinesses(): Observable<number> {
    return this.http.get<number>(`${environment.apiUrl}/businesses/count`);
  }

  addBusiness(business: Business): Observable<Business> {
    return this.http.post<Business>(`${environment.apiUrl}/business`, business);
  }

  getBusiness(business: Business): Observable<Business> {
    return this.http.get<Business>(`${environment.apiUrl}/business/${business._id}`);
  }

  getUsers(business: Business): Observable<any[]> {
    return this.http.get<any[]>(`${environment.apiUrl}/business/${business._id}/users`);
  }

  getDevices(business: Business): Observable<any[]> {
    return this.http.get<any[]>(`${environment.apiUrl}/business/${business._id}/devices`);
  }

  editBusiness(business: Business): Observable<any> {
    return this.http.put(`${environment.apiUrl}/business/${business._id}`, business, { responseType: 'text' });
  }

  deleteBusiness(business: Business): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/business/${business._id}`, { responseType: 'text' });
  }

}
