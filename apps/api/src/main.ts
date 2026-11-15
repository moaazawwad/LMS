import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { productionConfigProblems } from './common/security.js';
import { mountDocs } from './docs.js';

const problems = productionConfigProblems(process.env);
if (problems.length) {
  console.error(
    `Not starting, fix these settings first:\n- ${problems.join('\n- ')}`,
  );
  process.exit(1);
}

const app = configureApp(
  await NestFactory.create<NestExpressApplication>(AppModule),
);
// Behind a proxy (Railway, Render, a load balancer): TRUST_PROXY=1 so sign-in limits see the real address.
if (process.env.TRUST_PROXY)
  app.set(
    'trust proxy',
    Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY,
  );

// API docs: on by default while developing; in production only with API_DOCS=1.
if (process.env.NODE_ENV !== 'production' || process.env.API_DOCS === '1')
  mountDocs(app);

// In production one service can also serve the Angular build: set WEB_DIST to its folder.
const webDist = process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : null;
if (webDist && existsSync(join(webDist, 'index.html'))) {
  app.useStaticAssets(webDist);
  app.use(
    (
      req: { method: string; path: string },
      res: { sendFile(p: string): void },
      next: () => void,
    ) => {
      if (req.method === 'GET' && !req.path.startsWith('/api'))
        return res.sendFile(join(webDist, 'index.html'));
      next();
    },
  );
}

await app.listen(process.env.PORT ?? 3000);
