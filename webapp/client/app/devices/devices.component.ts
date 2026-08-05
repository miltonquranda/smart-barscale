import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';

import { DeviceService } from '../services/device.service';
import { ToastComponent } from '../shared/toast/toast.component';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';
import { Device } from '../shared/models/device.model';
import { User } from '../shared/models/user.model';

@Component({
  selector: 'app-devices',
  templateUrl: './devices.component.html',
  styleUrls: ['./devices.component.css']
})
export class DevicesComponent implements OnInit {
  user: User;
  device = new Device();
  devices: Device[] = [];
  isLoading = true;
  isEditing = false;

  addDeviceForm: FormGroup;
  serialNumber = new FormControl('', Validators.required);
  type = new FormControl('', Validators.required);

  constructor(private deviceService: DeviceService,
              private auth: AuthService,
              private userService: UserService,
              private formBuilder: FormBuilder,
              public toast: ToastComponent) { }

  ngOnInit() {
    console.log(this.auth.currentUser);
    this.getDevices();
    this.getUser();
    this.addDeviceForm = this.formBuilder.group({
      serialNumber: this.serialNumber,
      type: this.type,
    });
  }

  getDevices() {
    this.deviceService.getDevices().subscribe(
      data => {
        console.log(data)
        return this.devices = data
      },
      error => console.log(error),
      () => this.isLoading = false
    );
  }

  getUser() {
    this.userService.getUser(this.auth.currentUser).subscribe(
      data => {
        this.user = data
        console.log(this.user)
      },
      error => console.log(error),
      () => this.isLoading = false
    );
  }

  addDevice() {
    console.log(this.addDeviceForm.value)
    this.deviceService.addDevice({
      ...this.addDeviceForm.value,
      business: this.user.business,
    }).subscribe(
      res => {
        this.devices.push(res);
        this.addDeviceForm.reset();
        this.toast.setMessage('item added successfully.', 'success');
      },
      error => console.log(error)
    );
  }

  enableEditing(device: Device) {
    this.isEditing = true;
    this.device = device;
  }

  cancelEditing() {
    this.isEditing = false;
    this.device = new Device();
    this.toast.setMessage('item editing cancelled.', 'warning');
    // reload the cats to reset the editing
    this.getDevices();
  }

  editDevice(device: Device) {
    this.deviceService.editDevice(device).subscribe(
      () => {
        this.isEditing = false;
        this.device = device;
        this.toast.setMessage('item edited successfully.', 'success');
      },
      error => console.log(error)
    );
  }

  deleteDevice(device: Device) {
    if (window.confirm('Are you sure you want to permanently delete this item?')) {
      this.deviceService.deleteDevice(device).subscribe(
        () => {
          const pos = this.devices.map(elem => elem._id).indexOf(device._id);
          this.devices.splice(pos, 1);
          this.toast.setMessage('item deleted successfully.', 'success');
        },
        error => console.log(error)
      );
    }
  }

}
