import {
  Component,
  OnInit,
  AfterViewInit,
  ViewChild,
  ElementRef
} from '@angular/core';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators
} from '@angular/forms';
import { NgbDateStruct, NgbCalendar } from '@ng-bootstrap/ng-bootstrap';
import { Chart } from 'chart.js';
import * as moment from 'moment';
import { faCalendar } from '@fortawesome/free-solid-svg-icons';

import { BottleStatService } from '../services/bottleStat.service';
import { BottleService } from '../services/bottle.service';
import { ToastComponent } from '../shared/toast/toast.component';
import { BottleStat } from '../shared/models/bottleStat.model';
import { Business } from '../shared/models/business.model';
import { Bottle, NormalizedBottles } from '../shared/models/bottle.model';
import { AuthService } from '../services/auth.service';

const lineColors = [
  'rgba(255, 99, 132, .5)',
  'rgba(54, 162, 235, .5)',
  'rgba(255, 206, 86, .5)'
];

@Component({
  selector: 'app-cats',
  templateUrl: './bottleStats.component.html',
  styleUrls: ['./bottleStats.component.css']
})
export class BottleStatsComponent implements OnInit {
  @ViewChild('myChart') canvas: ElementRef;
  ctx: any;
  faCalendar = faCalendar;
  bottleStat = new BottleStat();
  bottleStats: BottleStat[] = [];
  bottles: NormalizedBottles = {};
  bottlesArray: Bottle[] = [];
  isLoading = true;
  isEditing = false;
  // date: {year: number, month: number};
  addBottleStatForm: FormGroup;
  date = new FormControl('', Validators.required);
  barcode = new FormControl('', Validators.required);
  weight = new FormControl('', Validators.required);

  constructor(
    private bottleStatService: BottleStatService,
    private bottleService: BottleService,
    private auth: AuthService,
    private formBuilder: FormBuilder,
    public toast: ToastComponent,
    private calendar: NgbCalendar
  ) {}

  ngOnInit() {
    this.pollBottleStats();
    this.getBottles();
    this.addBottleStatForm = this.formBuilder.group({
      weight: this.weight,
      date: this.date,
      barcode: this.barcode
    });
    console.log(this.addBottleStatForm);
  }

  pollBottleStats = () => {
    this.getBottleStats();
    setInterval(()=> {
      this.getBottleStats();
    }, 3000)
  }

  exportData() {
    console.log(this.bottleStats)

    const rows = this.bottleStats.map(stat => ({
      ...stat,
      business: (stat.business[0] as Business).name,
      barcode: stat.bottle[0].barcode,
      bottle: stat.bottle[0].name
    }))
    const firstRow = rows[0]
    delete firstRow.__v
    const headers = Object.keys(firstRow)
    console.log(headers)
    console.log(rows)
    const data = [headers, ...rows.map(r => Object.values(r))]
    console.log('data', data)
    const csvContent = 'data:text/csv;charset=utf-8,'
        + data.map(e => e.join(',')).join('\n');
    console.log(csvContent)
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0'); // January is 0!
    const yyyy = today.getFullYear();

    const dateString = mm + '/' + dd + '/' + yyyy;
    link.setAttribute('download', `smartbar_data_${dateString}.csv`);
    document.body.appendChild(link); // Required for FF

    link.click(); // This will download the data file named 'my_data.csv'.
  }

  getBottleStats() {
    const today = moment();
    const from_date = today.startOf('month').toString();
    const to_date = today.endOf('month').toString();
    const dateQuery = `?start=${from_date}&end=${to_date}`
    this.bottleStatService
      .getBottleStats(dateQuery)
      .subscribe(
        this.handleUpdateBottleStats,
        error => console.log(error),
        () => (this.isLoading = false)
      );
  }

  getBottles() {
    const [business]: Business[] | string[] = this.auth.currentUser.business;
    const businessId: string =
      ((business as Business)._id as string);
    this.bottleService.getBottlesInBusiness(businessId).subscribe(
      bottles => {
        this.handleUpdateBottles(bottles);
      },
      error => console.log(error),
      () => (this.isLoading = false)
    );
  }

  handleUpdateBottles = (bottles: NormalizedBottles) => {
    this.bottles = bottles;
    this.bottlesArray = Object.values(bottles);
  };

  handleUpdateBottleStats = (bottleStats: BottleStat[]) => {
    console.log('got new bottleSTats')
    this.bottleStats = bottleStats.sort((a,b) => b.date.localeCompare(a.date));
    this.loadChart();
  };

  sortByDate = (a: BottleStat, b: BottleStat) => {
    const dateA = moment(a.date);
    const dateB = moment(b.date);

    return dateB.isSameOrBefore(dateA) ? 1 : -1;
  };

  loadChart() {
    const statsByBottle: {
      [key: string]: BottleStat[];
    } = this.bottleStats.reduce((bottles, curr) => {
      (bottles[curr.barcode] = bottles[curr.barcode] || []).push(curr);
      return bottles;
    }, {});
    // console.log(statsByBottle);
    const bottles = this.bottleStats.reduce((bottles, curr) => {
      // console.log(curr);
      return !bottles.find(bottle => bottle._id === curr.bottle[0]._id)
        ? [...bottles, curr.bottle[0]]
        : bottles;
    }, []);
    // console.log(this.bottles);
    const bottleStatWeights = this.bottleStats.reduce((acc, curr) => {
      return [...acc, [curr.weight]];
    }, []);
    const bottleStatDates = this.bottleStats
      .reduce((acc, curr) => {
        return !acc.find(([date]) => date === curr.date)
          ? [...acc, curr.date]
          : acc;
      }, [])
      .sort((a, b) => (moment(b).isSameOrBefore(moment(a)) ? 1 : -1))
      .map((date) => moment(date).format('MM/DD/YYYY'));
      console.log(bottleStatDates)
      console.log(statsByBottle)
    if (this.canvas) {
      this.ctx = this.canvas.nativeElement.getContext('2d');
      let myChart = new Chart(this.ctx, {
        type: 'line',
        data: {
          labels: Array.from(new Set([...bottleStatDates])),
          datasets: Object.entries(statsByBottle).map(([id, value], i) => ({
            label: id,
            data: value
              .sort(this.sortByDate)
              .reduce((acc, curr) => [...acc, curr.weight], []),
            backgroundColor: [lineColors[i]],
            borderColor: [lineColors[i]],
            borderWidth: 2,
            fill: false
          }))
        },
        options: {
          responsive: true,
          animation: false
        }
      });
    }
  }

  addBottleStat() {
    console.log(this.addBottleStatForm.value);
    const [business] = this.auth.currentUser.business;
    console.log((business as Business)._id);
    const {
      barcode,
      weight,
      date: { day, month, year }
    } = this.addBottleStatForm.value;
    const convertedDate = moment(
      `${month}-${day}-${year}`,
      'MM-DD-YYYY'
    ).valueOf();
    console.log(convertedDate);
    console.log('bus', this.auth.currentUser);
    // return;
    this.bottleStatService
      .addBottleStat({
        barcode,
        weight,
        date: '' + convertedDate,
        business: (business as Business)._id
      })
      .subscribe(
        res => {
          console.log(res);
          const currentBottleStats = this.bottleStats;
          this.getBottles();
          currentBottleStats.push(res);
          this.handleUpdateBottleStats(currentBottleStats);

          // this.addBottleStatForm.reset();
          this.toast.setMessage('item added successfully.', 'success');
        },
        error => console.log(error)
      );
  }

  enableEditing(bottleStat: BottleStat) {
    this.isEditing = true;
    this.bottleStat = bottleStat;
  }

  cancelEditing() {
    this.isEditing = false;
    this.bottleStat = new BottleStat();
    this.toast.setMessage('item editing cancelled.', 'warning');
    // reload the cats to reset the editing
    this.getBottleStats();
  }

  editBottleStat(bottleStat: BottleStat) {
    this.bottleStatService.editBottleStat(bottleStat).subscribe(
      () => {
        this.isEditing = false;
        this.bottleStat = bottleStat;
        this.toast.setMessage('item edited successfully.', 'success');
      },
      error => console.log(error)
    );
  }

  deleteBottleStat(bottleStat: BottleStat) {
    if (
      window.confirm('Are you sure you want to permanently delete this item?')
    ) {
      this.bottleStatService.deleteBottleStat(bottleStat).subscribe(
        () => {
          const currentBottleStats = this.bottleStats.filter(
            (stat: BottleStat) => stat._id !== bottleStat._id
          );
          this.handleUpdateBottleStats(currentBottleStats);
          this.toast.setMessage('item deleted successfully.', 'success');
        },
        error => console.log(error)
      );
    }
  }
}
