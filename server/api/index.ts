import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'http';
import express, { Express } from 'express';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
// Imports the COMPILED output, not ../src/*.ts. Vercel's own bundler (esbuild)
// does not implement emitDecoratorMetadata, which Nest's constructor-based DI
// relies on throughout this app. `nest build` (real tsc, run in the Vercel
// Build Command — see vercel.json) already produced plain JS with the
// decorator metadata baked in; importing THAT sidesteps the gap.
import { AppModule } from '../dist/app.module';
import { configureApp, assertSecureConfig } from '../dist/bootstrap';

let appPromise: Promise<Express> | null = null;

async function bootstrapServerless(): Promise<Express> {
  const expressInstance = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressInstance), {
    logger: ['error', 'warn'],
  });
  configureApp(app);
  assertSecureConfig(app);
  await app.init(); // NOT app.listen() — Vercel owns the HTTP server
  return expressInstance;
}

function getApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = bootstrapServerless().catch((err) => {
      appPromise = null; // don't cache a failed boot — retry on next invocation
      throw err;
    });
  }
  return appPromise;
}

// Vercel's Node.js runtime invokes this directly as a plain Node (req, res)
// handler — it is NOT the AWS Lambda event/context model, so no
// @vendia/serverless-express (or similar) translation layer is needed. An
// Express app instance IS a (req, res) function, so we just forward to it.
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const expressInstance = await getApp();
  expressInstance(req, res);
}
