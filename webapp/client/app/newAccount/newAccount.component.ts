import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators
} from '@angular/forms';

import { UserService } from '../services/user.service';
import { BusinessService } from '../services/business.service';
import { ToastComponent } from '../shared/toast/toast.component';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-new-account',
  templateUrl: './newAccount.component.html'
})
export class NewAccountComponent implements OnInit {
  registerForm: FormGroup;
  firstName = new FormControl('', [Validators.required]);
  lastName = new FormControl('', [Validators.required]);
  email = new FormControl('', [
    Validators.required,
    Validators.minLength(3),
    Validators.maxLength(100)
  ]);
  password = new FormControl('', [
    Validators.required,
    Validators.minLength(6)
  ]);
  confirmPassword = new FormControl('', [
    Validators.required,
    Validators.minLength(6)
  ]);
  businessName = new FormControl('', [Validators.required]);
  businessZipCode = new FormControl('', [Validators.required]);
  token: any = {};

  constructor(
    private formBuilder: FormBuilder,
    private router: Router,
    public toast: ToastComponent,
    private userService: UserService,
    private businessService: BusinessService,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.registerForm = this.formBuilder.group({
      firstName: this.firstName,
      lastName: this.lastName,
      email: this.email,
      password: this.password,
      businessName: this.businessName,
      businessZipCode: this.businessZipCode,
      confirmPassword: this.confirmPassword
    });
  }

  setClassEmail() {
    return { 'has-danger': !this.email.pristine && !this.email.valid };
  }

  setClassPassword() {
    return {
      'has-danger':
        (!this.password.pristine && !this.password.valid) ||
        (!this.password.pristine &&
          this.password.value !== this.confirmPassword.value &&
          (this.password.value !== '' && this.confirmPassword.value !== ''))
    };
  }

  receiveCardToken(data: any) {
    this.token = data;
    this.register();
  }

  register() {
    const {
      email,
      password,
      firstName,
      lastName,
      businessName,
      businessZipCode
    } = this.registerForm.value;
    this.userService
      .register({
        username: email,
        firstName,
        lastName,
        email,
        password,
        role: 'user',
        business: [
          {
            name: businessName,
            zipCode: businessZipCode
          }
        ],
        token: this.token
      })
      .subscribe(
        res => {
          if (this.token.id) {
            this.authService.loginByToken(res.token);
            this.toast.setMessage('you successfully registered!', 'success');
            this.router.navigate(['/login']);
          } else {
            this.toast.setMessage('User Successfully Created', 'success');
          }

        },
        error => this.toast.setMessage('email already exists', 'danger')
      );
  }
}
