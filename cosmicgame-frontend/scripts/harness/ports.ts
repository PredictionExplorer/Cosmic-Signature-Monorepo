/** Canonicalize environment and saved-state ports before constructing any endpoint. */
export function harnessPort(value: unknown, name = 'service port'): number {
  const port =
    typeof value === 'number' || (typeof value === 'string' && /^[0-9]+$/.test(value))
      ? Number(value)
      : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Invalid ${name} in harness configuration; expected a port from 1 through 65535`,
    );
  }
  return port;
}

export function loopbackOrigin(port: unknown, hostname: '127.0.0.1' | 'localhost' = '127.0.0.1') {
  return `http://${hostname}:${harnessPort(port)}`;
}
