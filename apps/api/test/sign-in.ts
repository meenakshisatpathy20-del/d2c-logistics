import request from 'supertest';
import type { App } from 'supertest/types.js';

/** A supertest agent signed in as the demo founder (email + password, then the demo code). */
export async function signedIn(server: App) {
  const agent = request.agent(server);
  const login = await agent
    .post('/api/auth/login')
    .send({ email: 'founder@d2c.demo', password: process.env.DEMO_PASSWORD ?? 'D2C@demo2026' })
    .expect(200);
  await agent.post('/api/auth/verify').send({ challengeId: login.body.challengeId, code: login.body.demoCode }).expect(200);
  return agent;
}
