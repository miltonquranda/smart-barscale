import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { User } from '../shared/models/user.model';
import { environment } from '../../environments/environment';

@Injectable()
export class UserService {
  constructor(private http: HttpClient) { }

  register(user: User): Observable<User> {
    return this.http.post<User>(`${environment.apiUrl}/user`, user);
  }

  login(credentials): Observable<any> {
    return this.http.post(`${environment.apiUrl}/login`, credentials);
  }

  getUsers(): Observable<User[]> {
    return this.http.get<User[]>(`${environment.apiUrl}/users`);
  }

  countUsers(): Observable<number> {
    return this.http.get<number>(`${environment.apiUrl}/users/count`);
  }

  addUser(user: User): Observable<User> {
    return this.http.post<User>(`${environment.apiUrl}/user`, user);
  }

  getUser(user: User): Observable<User> {
    console.log('getting user', user)
    return this.http.get<User>(`${environment.apiUrl}/user/${user._id}`);
  }

  editUser(user: User): Observable<any> {
    return this.http.put(`${environment.apiUrl}/user/${user._id}`, user, {
      responseType: 'text'
    });
  }

  deleteUser(user: User): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/user/${user._id}`, { responseType: 'text' });
  }

  requestPasswordReset(email: string): Observable<User> {
    return this.http.post<any>(`${environment.apiUrl}/user/password-reset`, { email });
  }

  verifyPasswordReset(token: string, password: string): Observable<User> {
    console.log(password);
    return this.http.post<any>(`${environment.apiUrl}/user/password-reset-verify`, {
      password,
      token
    });
  }
}
