// MCPForge — reading a secret into the CLI without it ever being an argument
// or an echo. W0-P28 (the bootstrap admin's password), W0-P26 (a binding
// credential for `forge secrets put`).
//
// argv is visible to every process on the host and lands in shell history, so
// neither command takes the value as a flag. A terminal gets a raw-mode prompt
// that echoes nothing, asked twice; a pipe is read to its first line. Nothing
// here writes the value anywhere, and a mismatch is reported without it.

export interface HiddenLineOptions {
  /** What the prompt names, e.g. "Password". */
  readonly label: string;
}

/** The value, or '' when a terminal's two entries did not match. */
export async function readHiddenLine(options: HiddenLineOptions): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin)
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
    return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '';
  }
  const first = await promptHidden(`${options.label}: `);
  const second = await promptHidden(`Repeat ${options.label.toLowerCase()}: `);
  if (first !== second) {
    process.stderr.write(`forge: the two entries did not match.\n`);
    return '';
  }
  return first;
}

function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stderr.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (key: string): void => {
      for (const ch of key) {
        if (ch === '\r' || ch === '\n') {
          done();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          done();
          reject(new Error('Interrupted.'));
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    const done = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
    };
    stdin.on('data', onData);
  });
}
