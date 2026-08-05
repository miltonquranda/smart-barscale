import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { BottleStatsComponent } from './bottleStats/bottleStats.component';
import { DevicesComponent } from './devices/devices.component';
import { AboutComponent } from './about/about.component';
import { RegisterComponent } from './register/register.component';
import { LoginComponent } from './login/login.component';
import { LogoutComponent } from './logout/logout.component';
import { AccountComponent } from './account/account.component';
import { AdminComponent } from './admin/admin.component';
import { NotFoundComponent } from './not-found/not-found.component';
import { UsersComponent } from './users/users.component';
import { UserComponent } from './users/user/user.component';
import { BusinessesComponent } from './businesses/businesses.component';

import { AuthGuardLogin } from './services/auth-guard-login.service';
import { AuthGuardAdmin } from './services/auth-guard-admin.service';
import { BottlesComponent } from './bottles/bottles.component';
import { PasswordResetComponent } from './password-reset/password-reset.component';
import { BusinessComponent } from './business/business.component';

const routes: Routes = [
  { path: '', component: AboutComponent },
  { path: 'bottle-stats', component: BottleStatsComponent, canActivate: [AuthGuardLogin] },
  { path: 'bottles', component: BottlesComponent, canActivate: [AuthGuardLogin] },
  { path: 'register', component: RegisterComponent },
  { path: 'login', component: LoginComponent },
  { path: 'logout', component: LogoutComponent },
  {
    path: 'account',
    component: AccountComponent,
    canActivate: [AuthGuardLogin]
  },

  // Admin routes
  { path: 'devices', component: DevicesComponent, canActivate: [AuthGuardAdmin] },
  { path: 'admin', component: AdminComponent, canActivate: [AuthGuardAdmin],
    children: [
      { path: 'users', component: UsersComponent, canActivate: [AuthGuardAdmin] },
      { path: 'users/:id', component: UserComponent, canActivate: [AuthGuardAdmin] },
      { path: 'businesses', component: BusinessesComponent, canActivate: [AuthGuardAdmin] },
      { path: 'businesses/:id', component: BusinessComponent, canActivate: [AuthGuardAdmin] }
    ]
  },
  { path: 'notfound', component: NotFoundComponent },
  { path: 'password-reset', component: PasswordResetComponent },
  { path: '**', redirectTo: '/notfound' }
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class RoutingModule {}
