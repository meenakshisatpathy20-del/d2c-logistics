import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // The website forwards /api here, so trust its X-Forwarded-For for the caller's address.
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback');
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000', credentials: true });
  // API_PORT lets the API run beside the website in one service, where PORT belongs to the website.
  await app.listen(process.env.API_PORT ?? process.env.PORT ?? 4000);
}
await bootstrap();
