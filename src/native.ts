import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { config } from './config.js';
import { Rejection, requireThat } from './domain.js';
export type NativeResult = { publicKey: string; der: string };
export async function runNative(args: {
  mode: 'dkg' | 'sign';
  identity: string;
  participants: string[];
  storage: string;
  walletId: string;
  digest: string;
  send: (to: string, data: string) => Promise<void>;
  receive: (from: string) => Promise<string>;
}): Promise<NativeResult> {
  const pid = (name: string) =>
    config()
      .signers.find((s) => s.id === name)!
      .fingerprint.replaceAll(':', '')
      .toLowerCase();
  const child = spawn(
    resolve(process.env.QUORUM_NATIVE ?? '.build/quorum-signer'),
    [
      args.mode,
      pid(args.identity),
      args.participants.map(pid).join(','),
      resolve(args.storage, args.walletId + '.share'),
      resolve(args.storage, 'wrapping.key'),
      args.walletId,
      args.digest.replace(/^0x/, ''),
      config()
        .signers.map((s) => pid(s.id))
        .join(','),
    ],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, 30000);
  child.stdin.on('error', () => child.kill());
  const exit = new Promise<number | null>((resolveExit, reject) => {
    child.on('error', reject);
    child.on('exit', resolveExit);
  });
  // Attach a handler immediately so spawn errors cannot become unhandled rejections.
  void exit.catch(() => undefined);
  let result: NativeResult | undefined;
  try {
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      requireThat(
        line.length <= 8_388_640 && (total += line.length) <= 64_000_000,
        'native_message_bounds',
      );
      const [command, index, data = ''] = line.split(' ');
      if (command === 'SEND') {
        const target = args.participants[Number(index)];
        requireThat(target, 'native_peer');
        await args.send(target, data);
        child.stdin.write('ACK\n');
      } else if (command === 'RECV') {
        const target = args.participants[Number(index)];
        requireThat(target, 'native_peer');
        const message = await args.receive(target);
        child.stdin.write(message + '\n');
      } else if (command === 'DONE') result = { publicKey: '0x' + index, der: data };
      else if (command === 'FAIL') {
        const status = Number(index);
        const transportError = Number.isInteger(status) && ((status >>> 16) & 255) === 3;
        throw new Rejection(
          transportError
            ? 'native_transport_failed'
            : index === 'adapter'
              ? 'native_adapter_failure'
              : 'native_crypto_rejected',
        );
      } else throw new Rejection('native_adapter_failure');
    }
    requireThat(
      (await exit) === 0 && result,
      timedOut ? 'native_session_timeout' : 'native_adapter_failure',
    );
    return result;
  } finally {
    clearTimeout(timer);
    child.kill();
  }
}
