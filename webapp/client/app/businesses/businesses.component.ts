import { Component, OnInit } from '@angular/core';

import { ToastComponent } from '../shared/toast/toast.component';
import { AuthService } from '../services/auth.service';
import { BusinessService } from '../services/business.service';
import { Business } from '../shared/models/business.model';

@Component({
  selector: 'app-businesses',
  templateUrl: './businesses.component.html'
})
export class BusinessesComponent implements OnInit {

  businesses: Business[] = [];
  isLoading = true;

  constructor(public auth: AuthService,
              public toast: ToastComponent,
              private businessService: BusinessService) { }

  ngOnInit() {
    this.getBusinesses();
  }

  getBusinesses() {
    this.businessService.getBusinesses().subscribe(
      data => {
        console.log(data)
        return this.businesses = data
      },
      error => console.log(error),
      () => this.isLoading = false
    );
  }

  deleteBusiness(business: Business) {
    if (window.confirm('Are you sure you want to delete ' + business.name + '?')) {
      this.businessService.deleteBusiness(business).subscribe(
        data => this.toast.setMessage('business deleted successfully.', 'success'),
        error => console.log(error),
        () => this.getBusinesses()
      );
    }
  }

}
