import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators
} from '@angular/forms';

import { UserService } from '../services/user.service';
import { AuthService } from '../services/auth.service';
import { ToastComponent } from '../shared/toast/toast.component';

@Component({
  selector: 'app-password-reset',
  templateUrl: './password-reset.component.html',
  styleUrls: ['./password-reset.component.scss']
})
export class PasswordResetComponent implements OnInit {
  passwordResetForm: FormGroup;
  passwordVerifyForm: FormGroup;

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

  verificationToken = '';

  resetLinkSentSuccessfully = false;
  passwordResetSuccessfully = false;

  constructor(
    private formBuilder: FormBuilder,
    private route: ActivatedRoute,
    private router: Router,
    public toast: ToastComponent,
    private userService: UserService,
    private authService: AuthService
  ) {
    this.route.queryParams.subscribe(params => {
      console.log(params);
      this.verificationToken = params.token;
    });
  }

  ngOnInit() {
    this.passwordResetForm = this.formBuilder.group({
      email: this.email
    });

    this.passwordVerifyForm = this.formBuilder.group({
      password: this.password,
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
        this.password !== this.confirmPassword
    };
  }

  submitPasswordResetRequest() {
    const { email } = this.passwordResetForm.value;

    this.userService.requestPasswordReset(email).subscribe(
      res => {
        console.log(res);
        this.resetLinkSentSuccessfully = true;
        this.toast.setMessage(
          'Password reset link sent, check your email',
          'success'
        );
      },
      error => this.toast.setMessage('Email not found', 'danger')
    );
  }

  submitPasswordUpdateRequest() {
    const { password, confirmPassword } = this.passwordVerifyForm.value;
    console.log(password);

    this.userService
      .verifyPasswordReset(this.verificationToken, password)
      .subscribe(
        res => {
          console.log('reset res', res);
          this.passwordResetSuccessfully = true;

          this.toast.setMessage(
            'Password reset successfully, logging you in.',
            'success'
          );
          this.authService.loginByToken(res.token);
          this.router.navigate(['/login']);
        },
        error => this.toast.setMessage('Email not found', 'danger')
      );
  }
}
