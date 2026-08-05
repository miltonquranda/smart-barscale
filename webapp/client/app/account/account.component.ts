import { Component, OnInit } from '@angular/core';
import { ToastComponent } from '../shared/toast/toast.component';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { StripeService } from '../services/stripe.service';
import { User } from '../shared/models/user.model';

@Component({
  selector: 'app-account',
  templateUrl: './account.component.html'
})
export class AccountComponent implements OnInit {

  user: User;
  customer: any = {};
  isLoading = true;

  constructor(
    private auth: AuthService,
    public toast: ToastComponent,
    private userService: UserService,
    private stripeService: StripeService
  ) { }

  ngOnInit() {
    this.getUser();
  }

  getUser() {
    this.userService.getUser(this.auth.currentUser).subscribe(
      data => {
        if (data.customer_id) {
          this.getStripeCustomer(data.customer_id)
        }
        return this.user = data;
      },
      error => console.log(error),
      () => this.isLoading = false
    );
  }

  getStripeCustomer(customerId) {
    this.stripeService.getCustomer(customerId).subscribe(
      customer => {
        console.log(customer)
        return this.customer = customer;
      },
      error => console.log(error),
      () => this.isLoading = false)
      ;
  }

  save(user: User) {
    this.userService.editUser(user).subscribe(
      res => this.toast.setMessage('account settings saved!', 'success'),
      error => console.log(error)
    );
  }

}
