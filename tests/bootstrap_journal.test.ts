import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ethers } from "ethers";
import { BootstrapJournal } from "../scripts/lib/bootstrap_journal.js";
import { TEST_KEY } from "./common/bootstrap_chain.js";

test("Journal persists signed bytes before broadcast and refuses replacement, reorg and changed intent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sourcedao-journal-"));
  const file = path.join(root, "transactions.json"), signer = new ethers.Wallet(TEST_KEY);
  let receipt: any = null, latest = 0, pending = 0, drop = true;
  const hash = ethers.keccak256("0x1234"), broadcasts: string[] = [];
  const provider = {
    async getTransactionReceipt() { return receipt; },
    async getTransactionCount(_address: string, tag: string) { return tag === "pending" ? pending : latest; },
    async getTransaction() { return null; },
    async getBalance() { return 1000000000000000000n; },
    async getBlock() { return { hash }; },
    async waitForTransaction() { return receipt; },
    async broadcastTransaction(raw: string) {
      const saved = JSON.parse(await readFile(file, "utf8"));
      assert.equal(saved.transactions[0].raw_transaction, raw, "broadcast happened before durable journal");
      broadcasts.push(raw);
      if (drop) throw new Error("Connection dropped before broadcast reached chain");
      const tx = ethers.Transaction.from(raw);
      receipt = { status: 1, blockNumber: 2, blockHash: hash, contractAddress: ethers.getCreateAddress({ from: signer.address, nonce: tx.nonce }) };
      latest = pending = 1;
      return { hash: tx.hash };
    },
  };
  const wallet = { address: signer.address, provider, signTransaction: signer.signTransaction.bind(signer),
    async populateTransaction(request: any) { return { ...request, chainId: 31337, gasPrice: 1n, type: 0 }; },
  } as unknown as ethers.Wallet;
  const identity = { chain_id: 31337, genesis_hash: hash, config_sha256: "a".repeat(64), golden_sha256: "b".repeat(64), signer: signer.address.toLowerCase() };
  try {
    let journal = await BootstrapJournal.load(file, wallet, identity);
    const request = { data: "0x6000", gasLimit: 100000n };
    await assert.rejects(journal.transact("Committee.deployImplementation", request), /Connection dropped/);
    const original = await readFile(file, "utf8");
    await assert.rejects(BootstrapJournal.load(file, wallet, { ...identity, config_sha256: "c".repeat(64) }), /identity mismatch/);
    assert.equal(await readFile(file, "utf8"), original);
    latest = pending = 1;
    await assert.rejects(journal.recover(), /unknown replacement/);
    latest = 0;
    await assert.rejects(journal.recover(), /conflicting pending/);
    pending = 0; drop = false;
    journal = await BootstrapJournal.load(file, wallet, identity);
    await journal.recover();
    const result = await journal.transact("Committee.deployImplementation", request);
    assert.equal(result.txHash, ethers.keccak256(broadcasts[0]));
    assert.deepEqual(broadcasts, [broadcasts[0], broadcasts[0]]);
    assert.equal(journal.operations().length, 1);
    await assert.rejects(journal.transact("Committee.deployImplementation", { ...request, data: "0x6001" }), /intent differs/);
    journal.data.transactions[0].block_number = 3;
    await assert.rejects(journal.recover(), /reorganized/);
    journal.data.transactions[0].block_number = 2;
    receipt.blockHash = ethers.keccak256("0xabcd");
    await assert.rejects(journal.recover(), /reorganized/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
