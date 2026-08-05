import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Bottle } from '../shared/models/bottle.model';
import { environment } from '../../environments/environment';

@Injectable()
export class BottleService {

  constructor(private http: HttpClient) { }

  getBottles(): Observable<Bottle[]> {
    return this.http.get<Bottle[]>(`${environment.apiUrl}/bottles`);
  }

  getBottlesInBusiness(businessId: string): Observable<Bottle[]> {
    return this.http.get<Bottle[]>(`${environment.apiUrl}/bottles/${businessId}`);
  }

  countBottles(): Observable<number> {
    return this.http.get<number>(`${environment.apiUrl}/bottles/count`);
  }

  addBottle(bottle: Bottle): Observable<Bottle> {
    return this.http.post<Bottle>(`${environment.apiUrl}/bottle`, bottle);
  }

  getBottle(bottle: Bottle): Observable<Bottle> {
    return this.http.get<Bottle>(`${environment.apiUrl}/bottle/${bottle._id}`);
  }

  editBottle(bottle: Bottle): Observable<any> {
    return this.http.put(`${environment.apiUrl}/bottle/${bottle._id}`, bottle, { responseType: 'text' });
  }

  deleteBottle(bottle: Bottle): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/bottle/${bottle._id}`, { responseType: 'text' });
  }

}
