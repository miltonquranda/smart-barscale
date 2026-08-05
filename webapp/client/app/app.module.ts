import { NgModule, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { environment } from '../environments/environment';
import { JwtModule } from '@auth0/angular-jwt';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { AuthInterceptor } from './services/auth.interceptor';
import { RoutingModule } from './routing.module';
import { SharedModule } from './shared/shared.module';
import { CatService } from './services/cat.service';
import { BottleService } from './services/bottle.service';
import { BottleStatService } from './services/bottleStat.service';
import { DeviceService } from './services/device.service';
import { UserService } from './services/user.service';
import { BusinessService } from './services/business.service';
import { AuthService } from './services/auth.service';
import { StripeService } from './services/stripe.service';
import { AuthGuardLogin } from './services/auth-guard-login.service';
import { AuthGuardAdmin } from './services/auth-guard-admin.service';
import { AppComponent } from './app.component';
import { NavComponent } from './nav/nav.component';
import { CatsComponent } from './cats/cats.component';
import { BottleStatsComponent } from './bottleStats/bottleStats.component';
import { DevicesComponent } from './devices/devices.component';
import { AboutComponent } from './about/about.component';
import { RegisterComponent } from './register/register.component';
import { CheckoutComponent } from './checkout/checkout.component';
import { LoginComponent } from './login/login.component';
import { LogoutComponent } from './logout/logout.component';
import { AccountComponent } from './account/account.component';
import { AdminComponent } from './admin/admin.component';
import { NotFoundComponent } from './not-found/not-found.component';
import { BottlesComponent } from './bottles/bottles.component';
import { UsersComponent } from './users/users.component';
import { UserComponent } from './users/user/user.component';
import { BusinessesComponent } from './businesses/businesses.component';
import { BusinessComponent } from './business/business.component';
import { NewAccountComponent } from './newAccount/newAccount.component';

import { PasswordResetComponent } from './password-reset/password-reset.component';

export function tokenGetter() {
  return localStorage.getItem('token');
}

@NgModule({
  declarations: [
    AppComponent,
    NavComponent,
    CatsComponent,
    BottleStatsComponent,
    DevicesComponent,
    BottlesComponent,
    AboutComponent,
    RegisterComponent,
    LoginComponent,
    LogoutComponent,
    AccountComponent,
    AdminComponent,
    NotFoundComponent,
    CheckoutComponent,
    UsersComponent,
    BusinessesComponent,
    BusinessComponent,
    NewAccountComponent,
    PasswordResetComponent,
    UserComponent,
  ],
  imports: [
    RoutingModule,
    HttpClientModule,
    SharedModule,
    NgbModule,
    FontAwesomeModule,
    JwtModule.forRoot({
      config: {
        tokenGetter: tokenGetter,
        // whitelistedDomains: ['localhost:3000', 'localhost:4200']
      }
    })
  ],
  providers: [
    AuthService,
    AuthGuardLogin,
    AuthGuardAdmin,
    BottleStatService,
    DeviceService,
    CatService,
    UserService,
    BottleService,
    BusinessService,
    StripeService,
    {
      provide: HTTP_INTERCEPTORS,
      useClass: AuthInterceptor,
      multi: true,
    }
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  bootstrap: [AppComponent]
})

export class AppModule {
  constructor() {
    const app = initializeApp(environment.firebaseConfig);
    const analytics = getAnalytics(app);
  }
}
