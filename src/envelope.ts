// HATEOAS JSON envelope — every command returns this shape.

export interface NextAction {
  command: string;
  description: string;
}

export interface SuccessEnvelope<T = unknown> {
  ok: true;
  command: string;
  result: T;
  next_actions: NextAction[];
}

export interface ErrorEnvelope {
  ok: false;
  command: string;
  error: { message: string; code: string };
  fix: string;
  next_actions: NextAction[];
}

export type Envelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

export function success<T>(command: string, result: T, next_actions: NextAction[] = []): SuccessEnvelope<T> {
  return { ok: true, command, result, next_actions };
}

export function fail(command: string, message: string, code: string, fix: string, next_actions: NextAction[] = []): ErrorEnvelope {
  return { ok: false, command, error: { message, code }, fix, next_actions };
}

export function print(envelope: Envelope): void {
  process.stdout.write(JSON.stringify(envelope, null, 2) + "\n");
}
