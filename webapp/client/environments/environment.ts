// This file can be replaced during build by using the `fileReplacements` array.
// `ng build ---prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  firebaseConfig: {
    apiKey: "AIzaSyBD0PJGJNYyLhQf44MIqoD2c5xuWkD_MAc",
    authDomain: "smartbar-7418f.firebaseapp.com",
    projectId: "smartbar-7418f",
    storageBucket: "smartbar-7418f.firebasestorage.app",
    messagingSenderId: "250696915160",
    appId: "1:250696915160:web:63309154bfe33864a29fad",
    measurementId: "G-647SRFMJYV"
  },
  apiUrl: 'http://localhost:5001/demo-project/us-central1/api/api'
};

/*
 * In development mode, to ignore zone related error stack frames such as
 * `zone.run`, `zoneDelegate.invokeTask` for easier debugging, you can
 * import the following file, but please comment it out in production mode
 * because it will have performance impact when throw error
 */
// import 'zone.js/dist/zone-error';  // Included with Angular CLI.
