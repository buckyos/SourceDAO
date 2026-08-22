const expectedNode = "v24.12.0";
const expectedNpm = "11.6.2";
const npmUserAgent = process.env.npm_config_user_agent ?? "";
const npmVersion = /^npm\/([^ ]+)/.exec(npmUserAgent)?.[1];

if (process.version !== expectedNode) {
  throw new Error(`Node version mismatch: expected ${expectedNode}, have ${process.version}`);
}
if (npmVersion !== expectedNpm) {
  throw new Error(
    `npm version mismatch: expected ${expectedNpm}, have ${npmVersion ?? "unknown"}`,
  );
}

console.log(`verified SourceDAO toolchain: Node ${process.version}, npm ${npmVersion}`);
