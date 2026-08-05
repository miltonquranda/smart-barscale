import { Component, OnInit } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators
} from '@angular/forms';

import { BottleService } from '../services/bottle.service';
import { ToastComponent } from '../shared/toast/toast.component';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { Device } from '../shared/models/device.model';
import { User } from '../shared/models/user.model';
import { Business } from '../shared/models/business.model';
import { Bottle, NormalizedBottles } from '../shared/models/bottle.model';

@Component({
  selector: 'app-bottles',
  templateUrl: './bottles.component.html',
  styleUrls: ['./bottles.component.css']
})
export class BottlesComponent implements OnInit {
  user: User;
  device = new Device();
  bottles: NormalizedBottles = {};
  bottlesArray: Bottle[] = [];
  isLoading = true;
  isEditing = false;
  hasBusiness = true;

  addBottleForm: FormGroup;
  barcode = new FormControl('', Validators.required);
  brand = new FormControl('', Validators.required);
  name = new FormControl('', Validators.required);

  constructor(
    private bottleService: BottleService,
    private auth: AuthService,
    private userService: UserService,
    private formBuilder: FormBuilder,
    public toast: ToastComponent
  ) {
    this.user = this.auth.currentUser;
  }

  ngOnInit() {
    console.log('User', this.auth.currentUser);
    this.getBottles();
    this.addBottleForm = this.formBuilder.group({
      barcode: this.barcode,
      brand: this.brand,
      name: this.name
    });
  }

  getBottles() {
    const [business] = this.auth.currentUser.business;
    if (business) {
      this.bottleService
        .getBottlesInBusiness(
          business._id
        )
        .subscribe(
          data => {
            console.log(data);
            this.bottles = data;
            this.bottlesArray = Object.values(data);
          },
          error => {
            console.log(error);
            this.isLoading = false;
          },
          () => (this.isLoading = false)
        );
    } else {
      this.isLoading = false;
      this.hasBusiness = false;
    }
  }
}
