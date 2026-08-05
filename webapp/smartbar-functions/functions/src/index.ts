import * as functions from 'firebase-functions';
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import setRoutes from './routes';

dotenv.config();

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '10mb' }));

setRoutes(app);

export const api = functions.https.onRequest(app);
