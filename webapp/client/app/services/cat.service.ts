import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Cat } from '../shared/models/cat.model';
import { environment } from '../../environments/environment';

@Injectable()
export class CatService {

  constructor(private http: HttpClient) { }

  getCats(): Observable<Cat[]> {
    return this.http.get<Cat[]>(`${environment.apiUrl}/cats`);
  }

  countCats(): Observable<number> {
    return this.http.get<number>(`${environment.apiUrl}/cats/count`);
  }

  addCat(cat: Cat): Observable<Cat> {
    return this.http.post<Cat>(`${environment.apiUrl}/cat`, cat);
  }

  getCat(cat: Cat): Observable<Cat> {
    return this.http.get<Cat>(`${environment.apiUrl}/cat/${cat._id}`);
  }

  editCat(cat: Cat): Observable<any> {
    return this.http.put(`${environment.apiUrl}/cat/${cat._id}`, cat, { responseType: 'text' });
  }

  deleteCat(cat: Cat): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/cat/${cat._id}`, { responseType: 'text' });
  }

}
