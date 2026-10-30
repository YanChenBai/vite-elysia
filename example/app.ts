import { Elysia, t } from 'elysia';

export default new Elysia()
  .get('/api/hello', () => ({ message: 'Hello Elysia', pid: process.pid }))
  .post('/api/echo', ({ body }) => body)
  .ws('/ws', {
    body: t.Object({ message: t.String() }),

    message(ws, message) {
      ws.send({ ...message, pid: process.pid });
    },
  });
