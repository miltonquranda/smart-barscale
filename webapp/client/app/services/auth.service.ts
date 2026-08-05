import { Injectable, OnInit } from '@angular/core';
import { Router } from '@angular/router';

import { JwtHelperService } from '@auth0/angular-jwt';

import { UserService } from './user.service';
import { User } from '../shared/models/user.model';

import 'rxjs/add/operator/map';

@Injectable()
export class AuthService {
  loggedIn = false;
  isAdmin = false;
  isAuthenticating = false;
  token = '';
  currentUser: User = new User();

  constructor(
    private userService: UserService,
    private router: Router,
    private jwtHelper: JwtHelperService
  ) {
    const token = localStorage.getItem('token');
    if (token) {
      this.token = token;
      try {
        const decodedUser = this.decodeUserFromToken(token);
        this.setCurrentUser(decodedUser);
      } catch (err) {
        console.log(err)
        this.logout()
      }
    }
  }

  login(emailAndPassword) {
    return this.userService.login(emailAndPassword).map(res => {
      this.loginByToken(res.token);
    });
  }

  syncUser() {
    return this.userService.getUser(this.currentUser).subscribe(res => {
      console.log('sync res', res);
      this.setCurrentUser(res);
    });
  }

  loginByToken = token => {
    localStorage.setItem('token', token);
    const decodedUser = this.decodeUserFromToken(token);
    this.token = token;
    this.setCurrentUser(decodedUser);
  };

  logout() {
    localStorage.removeItem('token');
    this.loggedIn = false;
    this.isAdmin = false;
    this.currentUser = new User();
    this.router.navigate(['/']);
  }

  decodeUserFromToken(token) {
    return this.jwtHelper.decodeToken(token).user;
  }

  public getToken(): string {
    return this.token;
  }

  setCurrentUser(decodedUser) {
    this.currentUser.business = decodedUser.business;
    this.loggedIn = true;
    this.currentUser.firstName = decodedUser.firstName;
    this.currentUser.lastName = decodedUser.lastName;
    this.currentUser._id = decodedUser._id;
    this.currentUser.username = decodedUser.username;
    this.currentUser.role = decodedUser.role;
    decodedUser.role === 'admin'
      ? (this.isAdmin = true)
      : (this.isAdmin = false);
    delete decodedUser.role;
  }
}
