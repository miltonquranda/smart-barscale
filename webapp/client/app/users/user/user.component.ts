import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute, ParamMap } from '@angular/router';
import { ToastComponent } from '../../shared/toast/toast.component';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { BusinessService } from '../../services/business.service';
import { StripeService } from '../../services/stripe.service';
import { User } from '../../shared/models/user.model';
import { Business } from '../../shared/models/business.model';

@Component({
  selector: 'app-user',
  templateUrl: './user.component.html'
})
export class UserComponent implements OnInit {

  user: User;
  customer: any = {};
  isLoading = true;
  businessName = ''
  businesses: Business[] = []

  constructor(
    private auth: AuthService,
    public toast: ToastComponent,
    private userService: UserService,
    private route: ActivatedRoute,
    private businessService: BusinessService
  ) { }

  ngOnInit() {
    this.route.params.subscribe(params => {
      const userId = params['id']
      console.log(userId)
      this.getUser(userId)
    });
  }

  getUser(userId) {
    this.userService.getUser({ _id: userId } as User).subscribe(
      data => {
        console.log(data)
        return this.user = data;
      },
      error => console.log(error),
      () => this.isLoading = false
    );
  }

  save(user: User) {
    console.log(user)
    this.userService.editUser(user).subscribe(
      res => this.toast.setMessage('account settings saved!', 'success'),
      error => console.log(error)
    );
  }

  assignUserToBusiness(business: Business) {
    this.user.business.push(business)
    console.log(this.user)
    this.save(this.user)
  }

  removeBusiness(business) {
    if (window.confirm('Are you sure you want to remove ' + business.name + '?')) {
      const updatedBusinesses = this.user.business.indexOf(business)
      this.user.business = this.user.business.splice(0, 1)
    }
  }

  search(name) {
    console.log(name)
    if (!name) return
    this.businessService.searchBusiness({ name }).subscribe(
      res => {
        console.log('got result', res)
        this.businesses = res
      }
    )
  }

}
