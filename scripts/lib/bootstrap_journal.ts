import { ethers } from "ethers";
import { atomicJson, canonicalJson, readJson } from "./bootstrap_io.js";

export type JournalIdentity = { chain_id: number; genesis_hash: string; config_sha256: string; golden_sha256: string; signer: string };
type Entry = { name: string; raw_transaction: string; tx_hash: string; nonce: number; create_address: string | null; block_number?: number; block_hash?: string };
type Journal = { schema_version: string; identity: JournalIdentity; transactions: Entry[] };

/** One durable transaction per logical step. A retry never allocates a new nonce
 * for a step whose signed transaction may already have reached the network. */
export class BootstrapJournal {
  private constructor(readonly filename: string, readonly wallet: ethers.Wallet, readonly data: Journal) {}
  static async load(filename: string, wallet: ethers.Wallet, identity: JournalIdentity): Promise<BootstrapJournal> {
    let data: Journal;
    try { data = await readJson(filename); } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      data = { schema_version: "sourcedao-bootstrap-journal:v1", identity, transactions: [] };
    }
    if (data.schema_version !== "sourcedao-bootstrap-journal:v1" || canonicalJson(data.identity) !== canonicalJson(identity)) {
      throw new Error("Bootstrap journal identity mismatch; preserve the journal and use its original chain, config, artifacts and signer");
    }
    const names = new Set<string>(), nonces = new Set<number>();
    for (const entry of data.transactions) {
      const tx = ethers.Transaction.from(entry.raw_transaction);
      if (!entry.name || names.has(entry.name) || nonces.has(entry.nonce) || tx.hash !== entry.tx_hash ||
          tx.nonce !== entry.nonce || tx.chainId !== BigInt(identity.chain_id) || tx.from?.toLowerCase() !== identity.signer.toLowerCase() ||
          entry.create_address !== (tx.to ? null : ethers.getCreateAddress({ from: wallet.address, nonce: tx.nonce }))) {
        throw new Error("Invalid or conflicting transaction in bootstrap journal");
      }
      names.add(entry.name); nonces.add(entry.nonce);
    }
    return new BootstrapJournal(filename, wallet, data);
  }
  get provider(): ethers.Provider { return this.wallet.provider!; }
  async save(): Promise<void> { await atomicJson(this.filename, this.data); }
  async recover(): Promise<void> {
    for (const entry of this.data.transactions) await this.confirm(entry);
  }
  private async confirm(entry: Entry): Promise<ethers.TransactionReceipt> {
    let receipt = await this.provider.getTransactionReceipt(entry.tx_hash);
    if (entry.block_hash && (!receipt || receipt.blockHash !== entry.block_hash || receipt.blockNumber !== entry.block_number)) {
      throw new Error(`${entry.name}: recorded receipt was reorganized; stop and reconcile the candidate chain`);
    }
    if (!receipt) {
      const nonce = await this.provider.getTransactionCount(this.wallet.address, "latest");
      if (nonce > entry.nonce) throw new Error(`${entry.name}: nonce consumed by an unknown replacement; refusing another deployment`);
      const known = await this.provider.getTransaction(entry.tx_hash);
      if (!known) {
        if (await this.provider.getTransactionCount(this.wallet.address, "pending") > entry.nonce) {
          throw new Error(`${entry.name}: conflicting pending nonce; reconcile the original transaction`);
        }
        // A crash or lost RPC response is recovered by broadcasting exactly the
        // same signed bytes. Already-known responses are reconciled by hash.
        try { await this.provider.broadcastTransaction(entry.raw_transaction); } catch (error) {
          if (!await this.provider.getTransaction(entry.tx_hash) && !await this.provider.getTransactionReceipt(entry.tx_hash)) throw error;
        }
      }
      try { receipt = await this.provider.waitForTransaction(entry.tx_hash, 1, 120_000); } catch (error) {
        throw new Error(`${entry.name}: receipt confirmation failed for ${entry.tx_hash}; journal retained`, { cause: error });
      }
    }
    if (!receipt || receipt.status !== 1) throw new Error(`${entry.name}: transaction pending, timed out or reverted (${entry.tx_hash}); journal retained`);
    const block = await this.provider.getBlock(receipt.blockNumber);
    if (!block || block.hash !== receipt.blockHash) throw new Error(`${entry.name}: receipt is not canonical`);
    if (entry.create_address && receipt.contractAddress?.toLowerCase() !== entry.create_address.toLowerCase()) throw new Error(`${entry.name}: CREATE address mismatch`);
    if (!entry.block_hash) {
      entry.block_number = receipt.blockNumber; entry.block_hash = receipt.blockHash;
      await this.save();
    }
    return receipt;
  }
  async transact(name: string, request: ethers.TransactionRequest): Promise<{ txHash: string; blockNumber: number; address: string | null }> {
    let entry = this.data.transactions.find(item => item.name === name);
    if (entry) {
      const saved = ethers.Transaction.from(entry.raw_transaction);
      if ((saved.to?.toLowerCase() ?? null) !== (request.to ? String(request.to).toLowerCase() : null) ||
          saved.data.toLowerCase() !== String(request.data ?? "0x").toLowerCase() || saved.value !== BigInt(request.value?.toString() ?? "0") ||
          saved.gasLimit !== BigInt(request.gasLimit!.toString())) throw new Error(`${name}: resumed transaction intent differs from journal`);
    } else {
      const latest = await this.provider.getTransactionCount(this.wallet.address, "latest");
      const pending = await this.provider.getTransactionCount(this.wallet.address, "pending");
      if (latest !== pending) throw new Error("Bootstrap signer has unrelated pending transactions; use an exclusive ceremony signer");
      const tx = await this.wallet.populateTransaction({ ...request, nonce: pending });
      const fee = BigInt(tx.maxFeePerGas?.toString() ?? tx.gasPrice?.toString() ?? "0");
      if (await this.provider.getBalance(this.wallet.address) < BigInt(tx.gasLimit!.toString()) * fee + BigInt(tx.value?.toString() ?? "0")) {
        throw new Error(`${name}: insufficient balance for transaction gas budget`);
      }
      const raw = await this.wallet.signTransaction(tx);
      entry = { name, raw_transaction: raw, tx_hash: ethers.keccak256(raw), nonce: pending,
        create_address: tx.to ? null : ethers.getCreateAddress({ from: this.wallet.address, nonce: pending }) };
      this.data.transactions.push(entry);
      await this.save();
    }
    console.log(`${name}: awaiting canonical receipt ${entry.tx_hash}`);
    const receipt = await this.confirm(entry);
    return { txHash: entry.tx_hash, blockNumber: receipt.blockNumber, address: entry.create_address };
  }
  operations() {
    return this.data.transactions.filter(entry => entry.block_hash).map(entry => ({
      name: entry.name, status: "completed" as const, tx_hash: entry.tx_hash, block_number: entry.block_number!,
    }));
  }
}
