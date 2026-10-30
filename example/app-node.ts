import { node } from '@elysia/node';
import { Elysia, t } from 'elysia';

// The application selects and installs its own adapter.
export default new Elysia({ adapter: node() })
  .get('/api/hello', () => ({ message: 'Hello Elysia', pid: process.pid }))
  .post('/api/echo', ({ body }) => body)
  .ws('/ws', {
    body: t.Object({ message: t.String() }),

    parse(_ws, message) {
      return typeof message === 'string' ? JSON.parse(message) : message;
    },

    message(ws, message) {
      ws.send({ ...message, pid: process.pid });
    },
  });
