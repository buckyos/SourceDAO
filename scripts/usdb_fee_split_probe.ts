import { Contract, JsonRpcProvider, Wallet, ZeroAddress, getAddress } from "ethers";
import { writeFile } from "node:fs/promises";

const SYSTEM_STATE_ADDRESS = "0x0000000000000000000000000000000000001000";
const ISSUED_USDB_ATOMS_SLOT =
  "0xdd1651483272028cad87b8ab291a694a9deb1d7f6b60efe175f823c406233da2";
const MINER_FEE_BPS = 6_000n;
const DAO_FEE_BPS = 4_000n;
const BPS_DENOMINATOR = 10_000n;
const DEFAULT_TIMEOUT_MS = 300_000;

const DIVIDEND_ABI = [
  "function getDepositTokenBalance(address token) view returns (uint256)",
  "function updateTokenBalance(address token)",
];

interface ProbeOptions {
  rpcUrl: string;
  privateKey: string;
  dividendAddress: string;
  rewardRecipient: string;
  feeSplitBlock: number;
  output?: string;
  timeoutMs: number;
}

interface FeeObservation {
  txHash: string;
  blockNumber: number;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  totalFee: bigint;
  minerFee: bigint;
  daoFee: bigint;
  emission: bigint;
  senderBalanceBefore: bigint;
  senderBalanceAfter: bigint;
  rewardBalanceBefore: bigint;
  rewardBalanceAfter: bigint;
  dividendBalanceBefore: bigint;
  dividendBalanceAfter: bigint;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${label} must be a positive decimal integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${label} exceeds the JavaScript safe integer range`);
  }
  return parsed;
}

function parseOptions(argv: string[]): ProbeOptions {
  let rpcUrl = "";
  let dividendAddress = "";
  let rewardRecipient = "";
  let feeSplitBlock = 0;
  let output: string | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    switch (flag) {
      case "--rpc-url":
        rpcUrl = requireValue(argv, index, flag);
        index += 1;
        break;
      case "--dividend-address":
        dividendAddress = getAddress(requireValue(argv, index, flag));
        index += 1;
        break;
      case "--reward-recipient":
        rewardRecipient = getAddress(requireValue(argv, index, flag));
        index += 1;
        break;
      case "--fee-split-block":
        feeSplitBlock = parsePositiveInteger(
          requireValue(argv, index, flag),
          flag,
        );
        index += 1;
        break;
      case "--output":
        output = requireValue(argv, index, flag);
        index += 1;
        break;
      case "--timeout-ms":
        timeoutMs = parsePositiveInteger(
          requireValue(argv, index, flag),
          flag,
        );
        index += 1;
        break;
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }

  const privateKey =
    process.env.SOURCE_DAO_BOOTSTRAP_PRIVATE_KEY ??
    process.env.PRIVATE_KEY ??
    "";
  if (!rpcUrl || !privateKey || !dividendAddress || !rewardRecipient || feeSplitBlock === 0) {
    throw new Error(
      "Usage: tsx scripts/usdb_fee_split_probe.ts --rpc-url <url> " +
        "--dividend-address <address> --reward-recipient <address> " +
        "--fee-split-block <height> [--output <file>] [--timeout-ms <ms>]",
    );
  }
  if (dividendAddress === rewardRecipient) {
    throw new Error("Dividend and reward recipient must be distinct");
  }
  return {
    rpcUrl,
    privateKey,
    dividendAddress,
    rewardRecipient,
    feeSplitBlock,
    output,
    timeoutMs,
  };
}

async function waitForHeight(
  provider: JsonRpcProvider,
  minimum: number,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const height = await provider.getBlockNumber();
    if (height >= minimum) {
      return height;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for USDB block ${minimum}`);
}

async function readIssued(
  provider: JsonRpcProvider,
  blockNumber: number,
): Promise<bigint> {
  return BigInt(
    await provider.getStorage(
      SYSTEM_STATE_ADDRESS,
      ISSUED_USDB_ATOMS_SLOT,
      blockNumber,
    ),
  );
}

async function observeFeeTransaction(
  provider: JsonRpcProvider,
  txHash: string,
  sender: string,
  rewardRecipient: string,
  dividendAddress: string,
  feeSplitEnabled: boolean,
): Promise<FeeObservation> {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`missing receipt for ${txHash}`);
  }
  const block = await provider.getBlock(receipt.blockNumber);
  if (!block) {
    throw new Error(`missing block ${receipt.blockNumber}`);
  }
  if (block.transactions.length !== 1 || block.transactions[0].toLowerCase() !== txHash.toLowerCase()) {
    throw new Error(
      `fee probe block ${receipt.blockNumber} must contain exactly the probe transaction`,
    );
  }
  if (getAddress(block.miner) !== getAddress(rewardRecipient)) {
    throw new Error(
      `fee probe block miner ${block.miner} does not match ${rewardRecipient}`,
    );
  }
  const transaction = await provider.getTransaction(txHash);
  const effectiveGasPrice = receipt.gasPrice ?? transaction?.gasPrice;
  if (effectiveGasPrice == null) {
    throw new Error(`missing effective gas price for ${txHash}`);
  }
  const totalFee = receipt.gasUsed * effectiveGasPrice;
  const daoFee = feeSplitEnabled
    ? (totalFee * DAO_FEE_BPS) / BPS_DENOMINATOR
    : 0n;
  const minerFee = totalFee - daoFee;
  const parentBlock = receipt.blockNumber - 1;
  const [
    issuedBefore,
    issuedAfter,
    senderBalanceBefore,
    senderBalanceAfter,
    rewardBalanceBefore,
    rewardBalanceAfter,
    dividendBalanceBefore,
    dividendBalanceAfter,
  ] = await Promise.all([
    readIssued(provider, parentBlock),
    readIssued(provider, receipt.blockNumber),
    provider.getBalance(sender, parentBlock),
    provider.getBalance(sender, receipt.blockNumber),
    provider.getBalance(rewardRecipient, parentBlock),
    provider.getBalance(rewardRecipient, receipt.blockNumber),
    provider.getBalance(dividendAddress, parentBlock),
    provider.getBalance(dividendAddress, receipt.blockNumber),
  ]);
  const emission = issuedAfter - issuedBefore;
  if (emission <= 0n) {
    throw new Error(`fee probe block ${receipt.blockNumber} emitted no USDB`);
  }
  if (senderBalanceBefore - senderBalanceAfter !== totalFee) {
    throw new Error("probe sender balance delta does not equal refund-adjusted fee");
  }
  if (rewardBalanceAfter - rewardBalanceBefore !== emission + minerFee) {
    throw new Error("reward recipient delta does not equal emission plus miner fee");
  }
  if (dividendBalanceAfter - dividendBalanceBefore !== daoFee) {
    throw new Error(
      feeSplitEnabled
        ? "Dividend balance delta does not equal DAO fee"
        : "Dividend received transaction fees before fee-split activation",
    );
  }
  return {
    txHash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice,
    totalFee,
    minerFee,
    daoFee,
    emission,
    senderBalanceBefore,
    senderBalanceAfter,
    rewardBalanceBefore,
    rewardBalanceAfter,
    dividendBalanceBefore,
    dividendBalanceAfter,
  };
}

function serializeObservation(observation: FeeObservation): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(observation).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : value,
    ]),
  );
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const provider = new JsonRpcProvider(options.rpcUrl);
  const wallet = new Wallet(options.privateKey, provider);
  if (
    getAddress(wallet.address) === getAddress(options.rewardRecipient) ||
    getAddress(wallet.address) === getAddress(options.dividendAddress)
  ) {
    throw new Error("fee probe sender must be distinct from reward recipients");
  }

  const preGateHead = await provider.getBlockNumber();
  if (preGateHead + 1 >= options.feeSplitBlock) {
    throw new Error(
      `fee probe requires room before activation: head=${preGateHead}, ` +
        `feeSplitBlock=${options.feeSplitBlock}`,
    );
  }
  const preGateTransaction = await wallet.sendTransaction({
    to: "0x0000000000000000000000000000000000002000",
    value: 0,
  });
  const preGateReceipt = await preGateTransaction.wait();
  if (!preGateReceipt) {
    throw new Error("missing pre-gate fee probe receipt");
  }
  if (preGateReceipt.blockNumber >= options.feeSplitBlock) {
    throw new Error(
      `pre-gate transaction landed at ${preGateReceipt.blockNumber}, ` +
        `not before ${options.feeSplitBlock}`,
    );
  }
  const preGate = await observeFeeTransaction(
    provider,
    preGateTransaction.hash,
    wallet.address,
    options.rewardRecipient,
    options.dividendAddress,
    false,
  );

  await waitForHeight(provider, options.feeSplitBlock, options.timeoutMs);
  const probeTransaction = await wallet.sendTransaction({
    to: "0x0000000000000000000000000000000000002001",
    value: 0,
  });
  await probeTransaction.wait();
  const probe = await observeFeeTransaction(
    provider,
    probeTransaction.hash,
    wallet.address,
    options.rewardRecipient,
    options.dividendAddress,
    true,
  );
  if (probe.blockNumber < options.feeSplitBlock) {
    throw new Error(
      `post-gate transaction landed at ${probe.blockNumber}, ` +
        `before ${options.feeSplitBlock}`,
    );
  }

  const dividend = new Contract(options.dividendAddress, DIVIDEND_ABI, wallet);
  const syncTransaction = await dividend.updateTokenBalance(ZeroAddress);
  const syncReceipt = await syncTransaction.wait();
  if (!syncReceipt) {
    throw new Error("missing Dividend ledger-sync receipt");
  }
  const parentBlock = syncReceipt.blockNumber - 1;
  const ledgerBefore = BigInt(
    await dividend.getDepositTokenBalance(ZeroAddress, {
      blockTag: parentBlock,
    }),
  );
  const balanceBefore = await provider.getBalance(
    options.dividendAddress,
    parentBlock,
  );
  const pendingBefore = balanceBefore - ledgerBefore;
  if (pendingBefore <= 0n) {
    throw new Error("Dividend had no pending consensus fee before ledger sync");
  }
  const sync = await observeFeeTransaction(
    provider,
    syncTransaction.hash,
    wallet.address,
    options.rewardRecipient,
    options.dividendAddress,
    true,
  );
  const ledgerAfter = BigInt(
    await dividend.getDepositTokenBalance(ZeroAddress, {
      blockTag: syncReceipt.blockNumber,
    }),
  );
  if (ledgerAfter - ledgerBefore !== pendingBefore) {
    throw new Error(
      "Dividend ledger sync did not account for the full pre-transaction native balance delta",
    );
  }
  const pendingAfter = sync.dividendBalanceAfter - ledgerAfter;
  if (pendingAfter !== sync.daoFee) {
    throw new Error(
      "Dividend post-sync pending balance does not equal the sync transaction DAO fee",
    );
  }

  const result = {
    status: "ok",
    feeSplitBlock: options.feeSplitBlock,
    rewardRecipient: getAddress(options.rewardRecipient),
    dividendAddress: getAddress(options.dividendAddress),
    sender: getAddress(wallet.address),
    preGate: serializeObservation(preGate),
    probe: serializeObservation(probe),
    ledgerSync: {
      ...serializeObservation(sync),
      ledgerBefore: ledgerBefore.toString(),
      ledgerAfter: ledgerAfter.toString(),
      pendingBefore: pendingBefore.toString(),
      pendingAfter: pendingAfter.toString(),
    },
  };
  const encoded = JSON.stringify(result, null, 2) + "\n";
  if (options.output) {
    await writeFile(options.output, encoded, "utf8");
  }
  process.stdout.write(encoded);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
