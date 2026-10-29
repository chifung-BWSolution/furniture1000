// Client for the dedicated SketchUp session (fds_codex_session.rb): one JSON line per TCP connection.
import { randomUUID } from 'node:crypto';
import net from 'node:net';

export function bridgeCall(port, cmd, args = {}, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = net.connect({ host: '127.0.0.1', port });
    let buffer = '';
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => done(new Error(`bridge_timeout:${cmd}`)), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify({ id, cmd, args })}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      let reply;
      try {
        reply = JSON.parse(buffer.slice(0, newline));
      } catch {
        return done(new Error('bridge_reply_invalid'));
      }
      if (reply.id !== id) return done(new Error('bridge_reply_mismatch'));
      if (!reply.ok) return done(new Error(String(reply.error ?? 'bridge_error')));
      done(null, reply.result);
    });
    socket.on('error', (error) => done(error));
    socket.on('close', () => done(new Error('bridge_closed')));
  });
}

/** The session must belong to this job; otherwise we could be talking to someone else's SketchUp. */
export async function assertIdentity(port, jobId, nonce, options) {
  const identity = await bridgeCall(port, 'identity', {}, options);
  if (identity?.job_id !== jobId || identity?.nonce !== nonce) throw new Error('bridge_identity_mismatch');
  if (identity?.model_job_id !== jobId) throw new Error('bridge_model_mismatch');
  return identity;
}

export function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

export async function pickPort(start, count = 10) {
  for (let port = start; port < start + count; port++) {
    if (await portFree(port)) return port;
  }
  throw new Error('bridge_port_unavailable');
}
