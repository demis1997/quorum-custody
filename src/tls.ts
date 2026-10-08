import https from 'node:https';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TLSSocket } from 'node:tls';
import { config, dev } from './config.js';
import { Rejection, requireThat } from './domain.js';
export function tlsOptions(identity: string) {
  return {
    ca: readFileSync(resolve(dev, 'tls/ca.crt')),
    key: readFileSync(resolve(dev, `tls/${identity}.key`)),
    cert: readFileSync(resolve(dev, `tls/${identity}.crt`)),
    minVersion: 'TLSv1.3' as const,
  };
}
export function peerIdentity(socket: TLSSocket) {
  requireThat(socket.authorized, 'unauthorized_peer', 401);
  const cert = socket.getPeerCertificate();
  const c = config();
  if (cert.fingerprint256 === c.coordinatorFingerprint) return 'coordinator';
  const peer = c.signers.find((p) => p.fingerprint === cert.fingerprint256);
  requireThat(peer, 'unauthorized_peer', 401);
  return peer.id;
}
export function callSigner<T>(
  identity: string,
  target: string,
  path: string,
  body?: unknown,
  timeout = 35000,
): Promise<T> {
  const peer = config().signers.find((p) => p.id === target);
  requireThat(peer, 'unknown_signer');
  return new Promise((resolvePromise, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(
      new URL(path, peer.url),
      {
        ...tlsOptions(identity),
        method: payload ? 'POST' : 'GET',
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : undefined,
        timeout,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 9_000_000) req.destroy(new Rejection('response_bounds'));
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode !== 200)
              reject(new Rejection(parsed.error ?? 'signer_rejected', res.statusCode));
            else resolvePromise(parsed);
          } catch {
            reject(new Rejection('invalid_signer_response'));
          }
        });
      },
    );
    req.on('socket', (sock) => {
      const socket = sock as TLSSocket;
      const checkPin = () => {
        if (socket.getPeerCertificate().fingerprint256 !== peer.fingerprint)
          req.destroy(new Rejection('peer_pin_mismatch'));
      };
      if (socket.authorized && socket.getPeerCertificate().fingerprint256) checkPin();
      else socket.once('secureConnect', checkPin);
    });
    req.on('timeout', () => req.destroy(new Rejection('signer_timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}
