import * as dotenv from 'dotenv';
import * as express from 'express';
import * as morgan from 'morgan';
// import * as mongoose from 'mongoose';
import * as path from 'path';

import setRoutes from './routes';

const app = express();
dotenv.load({ path: '.env' });
app.set('port', (process.env.PORT || 3000));

app.use('/', express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

let mongodbURI;
console.log(process.env.NODE_ENV)
if (process.env.NODE_ENV === 'dev') {
  mongodbURI = process.env.MONGODB_PROD_URI;
} else {
  mongodbURI = process.env.MONGODB_URI;
  app.use(morgan('dev'));
}

// mongoose.Promise = global.Promise;
// mongoose.connect(mongodbURI)
//   .then(db => {
//     console.log('Connected to MongoDB');

setRoutes(app);

app.get('/*', function (req, res) {
  const indexPath = path.join(__dirname, '../public/index.html');
  if (require('fs').existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send('Backend is running. Access the frontend at http://localhost:4200');
  }
});
// Error handling
app.use(function (err, req, res, next) {
  console.log('from error handler', err)
  let error = { statusCode: 500, message: err.message };
  try {
    if (typeof err.message === 'string' && err.message.startsWith('{')) {
      error = JSON.parse(err.message);
    }
  } catch (e) {
    console.log(e);
  }
  res.status(error.statusCode || 500).send({ ...error });
})

if (!module.parent) {
  app.listen(app.get('port'), () => console.log(`Angular Full Stack listening on port ${app.get('port')}`));
}
//   })
//   .catch(err => console.error(err));


export { app };
