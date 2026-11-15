/**
 * Writes the API description to docs/openapi.json (repo root), for Postman or
 * any OpenAPI tool: Postman → Import → choose the file.
 *   npm run build && npm run docs:export
 * It builds the app without opening a port or touching the database.
 */
import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

process.env.JWT_SECRET ??= 'only-used-to-build-the-docs';
process.env.DATABASE_URL ??= 'postgresql://unused@localhost/unused';

const { AppModule } = await import('./app.module.js');
const { configureApp } = await import('./app.setup.js');
const { buildOpenApi } = await import('./docs.js');

const app = configureApp(
  await NestFactory.create(AppModule, { logger: ['error'] }),
);
await app.init();
const doc = buildOpenApi(app);
const out = resolve(process.argv[2] ?? '../../docs/openapi.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
await app.close();
console.log(`Wrote ${Object.keys(doc.paths).length} routes to ${out}`);
