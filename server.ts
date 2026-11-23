import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { getDb, getUploadsDir } from './server/db/database';
import { runMigrations } from './server/db/migrations';
import { seedDatabase } from './server/db/seed';
import authRoutes from './server/routes/auth';
import vehicleRoutes from './server/routes/vehicles';
import operationsRoutes from './server/routes/operations';
import docsBillingRoutes from './server/routes/documentsAndBilling';
import financeMarketplaceCalendarRoutes from './server/routes/financeMarketplaceCalendar';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Initialize SQLite database, run migrations & seed demo data
  const db = getDb();
  runMigrations(db);
  seedDatabase(db);

  app.set('trust proxy', 1);

  // Security headers configured to allow iFrame preview & inline React assets
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    })
  );

  app.use(express.json({ limit: '4mb' }));
  app.use(express.urlencoded({ extended: true, limit: '4mb' }));

  // Rate limiting on auth & public contact endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Trop de requêtes, veuillez réessayer dans quelques minutes.' },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/marketplace/listings/*/contact', authLimiter);

  // Healthcheck
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'HexaVO', timestamp: new Date().toISOString() });
  });

  // Uploaded vehicle photos
  app.use('/uploads', express.static(getUploadsDir()));

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/vehicles', vehicleRoutes);
  app.use('/api', operationsRoutes);
  app.use('/api', docsBillingRoutes);
  app.use('/api', financeMarketplaceCalendarRoutes);

  // Global API error handler
  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Erreur serveur interne';
    res.status(400).json({ error: message });
  });

  // Vite dev middleware or production static assets
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`HexaVO server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start HexaVO server:', err);
  process.exit(1);
});
