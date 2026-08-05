import {
  AfterViewChecked,
  ChangeDetectorRef,
  Component,
  AfterViewInit
} from '@angular/core';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html'
})
export class AppComponent implements AfterViewChecked, AfterViewInit {
  constructor(
    public auth: AuthService,
    private changeDetector: ChangeDetectorRef
  ) {}

  // This fixes: https://github.com/DavideViolante/Angular-Full-Stack/issues/105
  ngAfterViewChecked() {
    this.changeDetector.detectChanges();
  }

  ngAfterViewInit() {
    console.log('after view init');
    this.auth.syncUser();
  }
}
