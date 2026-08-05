import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { BottleStat } from '../shared/models/bottleStat.model';
import { environment } from '../../environments/environment';

@Injectable()
export class BottleStatService {

  constructor(private http: HttpClient) { }

  getBottleStats(): Observable<BottleStat[]> {
    return this.http.get<BottleStat[]>(`${environment.apiUrl}/bottle-stats`);
  }

  countBottleStats(): Observable<number> {
    return this.http.get<number>(`${environment.apiUrl}/bottle-stats/count`);
  }

  addBottleStat(bottleStat: BottleStat): Observable<BottleStat> {
    return this.http.post<BottleStat>(`${environment.apiUrl}/bottle-stats`, bottleStat);
  }

  getBottleStat(bottleStat: BottleStat): Observable<BottleStat> {
    return this.http.get<BottleStat>(`${environment.apiUrl}/bottle-stat/${bottleStat._id}`);
  }

  editBottleStat(bottleStat: BottleStat): Observable<any> {
    return this.http.put(`${environment.apiUrl}/bottle-stat/${bottleStat._id}`, bottleStat, { responseType: 'text' });
  }

  deleteBottleStat(bottleStat: BottleStat): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/bottle-stat/${bottleStat._id}`, { responseType: 'text' });
  }

}
