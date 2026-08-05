import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute, ParamMap } from '@angular/router';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators
} from "@angular/forms";
import { ToastComponent } from '../shared/toast/toast.component';
import { AuthService } from '../services/auth.service';
import { BusinessService } from '../services/business.service';
import { Business } from '../shared/models/business.model';
import { User } from '../shared/models/user.model';
import { Device } from '../shared/models/device.model';

@Component({
  selector: 'app-businesses',
  templateUrl: './business.component.html'
})
export class BusinessComponent implements OnInit {

  business: Business
  users: User[] = []
  devices: Device[] = []
  isLoading = true;
  businessForm: FormGroup;

  constructor(
    private formBuilder: FormBuilder,
    public auth: AuthService,
    public toast: ToastComponent,
    private businessService: BusinessService,
    private route: ActivatedRoute
  ) {
    this.businessForm = this.formBuilder.group({
      name: this.formBuilder.control('', Validators.required),
      zipCode: this.formBuilder.control('', Validators.required)
    });
  }

  ngOnInit() {
    // this.getBusiness();
    console.log(this.route.params)
    this.route.params.subscribe(params => {
      const businessId = params['id']
      // get the business
      this.getBusiness(businessId)
      // get the business users
      this.getBusiness(businessId, 'users')
      // get business devices
      this.getBusiness(businessId, 'devices')
    });
  }

  getBusiness(id, path = '') {
    this.businessService.getBusiness(id, path).subscribe(
      data => {
        console.log(data)
        // if this is just the business reset the form
        if (!path) {
          this.businessForm.reset(data)
        }

        return this[path ? path : 'business'] = data
      },
      error => console.log(error),
      () => this.isLoading = false
    );
  }

  update() {
    console.log({ ...this.business, ...this.businessForm.value })
    if (window.confirm('Are you sure you want to update ' + this.business.name + '?')) {
      this.businessService.editBusiness({ ...this.business, ...this.businessForm.value }).subscribe(
        data => this.toast.setMessage('business updated successfully.', 'success'),
        error => console.log(error),
        () => this.getBusiness(this.business._id)
      );
    }
  }

  // deleteBusiness(business: Business) {
  //   if (window.confirm('Are you sure you want to delete ' + business.name + '?')) {
  //     this.businessService.deleteBusiness(business).subscribe(
  //       data => this.toast.setMessage('business deleted successfully.', 'success'),
  //       error => console.log(error),
  //       () => this.getBusinesses()
  //     );
  //   }
  // }

}
