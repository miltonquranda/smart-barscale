import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { Device } from '../shared/models/device.model';
import { environment } from '../../environments/environment';

@Injectable()
export class DeviceService {

  constructor(private http: HttpClient) { }

  getDevices(): Observable<Device[]> {
    return this.http.get<Device[]>(`${environment.apiUrl}/devices`);
  }

  countDevices(): Observable<number> {
    return this.http.get<number>(`${environment.apiUrl}/devices/count`);
  }

  addDevice(device: Device): Observable<Device> {
    return this.http.post<Device>(`${environment.apiUrl}/device`, device);
  }

  getDevice(device: Device): Observable<Device> {
    return this.http.get<Device>(`${environment.apiUrl}/device/${device._id}`);
  }

  editDevice(device: Device): Observable<any> {
    return this.http.put(`${environment.apiUrl}/device/${device._id}`, device, { responseType: 'text' });
  }

  deleteDevice(device: Device): Observable<any> {
    return this.http.delete(`${environment.apiUrl}/device/${device._id}`, { responseType: 'text' });
  }

}
