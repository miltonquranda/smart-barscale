import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable()
export class StripeService {

  constructor(private http: HttpClient) { }

  getCustomer(customerId): Observable<any> {
    return this.http.get<any>(`${environment.apiUrl}/stripe/customer/${customerId}`);
  }


}
