import path from 'path';
import express from 'express';
import cors from 'cors';
// import helmet from 'helmet';
import morgan from 'morgan';
import filesRoutes from './routes/files.routes';


import authRoutes from './routes/auth.routes';
import jobRoutes from './routes/jobs.routes';
import imageRoutes from './routes/images.routes';
import { errorHandler } from './middleware/error';

export function buildApp() {
  const app = express();

  // Middleware
  // app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan('dev'));

  // ---- Static frontend (public/) ----
  // Serve /public/* assets and root index.html
  const publicDir = path.join(process.cwd(), 'public');
  app.use('/public', express.static(publicDir));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  // ---- API routes ----
  app.use('/v1/auth', authRoutes);
  app.use('/v1/jobs', jobRoutes);
  app.use('/v1/images', imageRoutes);
  app.use('/v1/files', filesRoutes);

  // Error handler (keep last)
  app.use(errorHandler);

  return app;
}
