import { exit } from "node:process";
import readline from "node:readline/promises";

import { ethers, network } from "hardhat";
import { HttpNetworkConfig } from "hardhat/types";

const MAIN_ADDRESS = "0x2fc3186176B80EA829A7952b874F36f7cb8bd184"; // opmain main contract address

function convertVersion(version: string): number {
    let versions = version.split('.');
    if (versions.length < 3) {
        throw new Error(`Invalid version format: ${version}. Expected format is 'major.minor.patch'.`);
    }

    let major = parseInt(versions[0], 10);
    let minor = parseInt(versions[1], 10);
    let patch = parseInt(versions[2], 10);

    return major*10000000000+minor*100000+patch
}

function zeroPadLeft(value: number | string | undefined): string{
  if (undefined === value) {
    throw new Error('value is undefined')
  }
  const big = ethers.toBigInt(value.toString())
  const hex = ethers.toBeHex(big)
  const result = ethers.zeroPadValue(hex, 32)
  return result
}

function parseParams(params: any[]): any {
    let propose_type = params[params.length - 1];
    switch (propose_type) {
        case "createProject":
            return [
                zeroPadLeft(params[0]),                 // project id
                ethers.encodeBytes32String(params[1]), // version
                zeroPadLeft(convertVersion(params[2])),                 // project name
                zeroPadLeft(params[3]),
                zeroPadLeft(params[4]),
                ethers.encodeBytes32String(params[5]),
            ]
        case "acceptProject":
            return [
                zeroPadLeft(params[0]),                 // project id
                ethers.encodeBytes32String(params[1]), // version
                zeroPadLeft(convertVersion(params[2])),                 // project name
                zeroPadLeft(params[3]),
                zeroPadLeft(params[4]),
                ethers.encodeBytes32String(params[5]),
            ]
        case "upgradeContract":
            return [
                ethers.zeroPadValue(params[0] as string, 32),
                ethers.zeroPadValue(params[1] as string, 32),
                ethers.encodeBytes32String(propose_type),
            ]
        case "setCommittees":
            let ret_params = [];
            for (let i = 0; i < params.length - 1; i++) {
                ret_params.push(ethers.zeroPadValue(params[i] as string, 32));
            }
            ret_params.push(ethers.encodeBytes32String(propose_type));
            return ret_params;
        default:
            throw new Error(`Unsupported proposal type: ${propose_type}.`);
    }
}

async function vote() {
    console.log(`Using network ${network.name}, endpoint: ${(network.config as HttpNetworkConfig).url}`);
    
    let signer = (await ethers.getSigners())[0];
    if (!signer) {
        console.error("No signer found. Please add your private key to the hardhat config file.");
        return;
    }

    console.log("Signer address:", await signer.getAddress());

    console.log("Connecting to dao contract at:", MAIN_ADDRESS);
    const dao = await ethers.getContractAt("SourceDao", MAIN_ADDRESS);

    const committee = await ethers.getContractAt("SourceDaoCommittee", await dao.committee());
    console.log("use Committee contract address:", await committee.getAddress());

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let id = await rl.question("Please input the proposal id to vote for: ");

    let proposal_id = parseInt(id);
    if (isNaN(proposal_id) || proposal_id <= 0) {
        console.error("Invalid proposal id. Please input a valid number greater than 0.");
        return;
    }

    let proposeInfo = await committee.proposalOf(proposal_id);
    if (proposeInfo.origin === ethers.ZeroAddress) {
        console.error(`Proposal ${proposal_id} not found.`);
        return;
    }
    console.log(`Propoal ${proposal_id} info:`)
    console.log(`\torigin: ${proposeInfo.origin}`);
    console.log(`\State: ${proposeInfo.state}`);
    console.log(`\expired at: ${new Date(Number(proposeInfo.expired) * 1000).toLocaleString()}`);

    let extra = await committee.proposalExtraOf(proposal_id);
    if (extra.from !== ethers.ZeroAddress) {
        console.log("This is a full proposal!");
        console.log("calcuting your votes...");
        let dev_token = await ethers.getContractAt("DevToken", await dao.devToken());
        let dev_balance = await dev_token.balanceOf(await signer.getAddress());
        let normal_token = await ethers.getContractAt("NormalToken", await dao.normalToken());
        let normal_balance = await normal_token.balanceOf(await signer.getAddress());

        let ratio = await committee.devRatio();
        let totalVotes = dev_balance * ratio / 100n + normal_balance;

        console.log(`You have ${ethers.formatUnits(dev_balance, 18)} dev tokens and ${ethers.formatUnits(normal_balance, 18)} normal tokens, total votes: ${ethers.formatUnits(totalVotes, 18)}`);
    }

    let vote = undefined;
    while (vote === undefined) {
        let voteStr = await rl.question("Please input your vote (s for support, r for reject): ");
        if (voteStr === 's' || voteStr === 'support') {
            vote = true;
        } else if (voteStr === 'r' || voteStr === 'reject') {
            vote = false;
        } else {
            console.error("Invalid input. Please input 's' for support or 'r' for reject.");
        }
    }

    console.log("getting proposal parameters from BuckyOS SourceDAO Backend:");
    let proposal_result = await (await fetch(`https://dao.buckyos.org/api/proposal/${proposal_id}`)).json();
    if (proposal_result.code !== 0) {
        console.error(`Failed to get proposal ${proposal_id} parameters: err code ${proposal_result.code}, ${proposal_result.message}`);
        return;
    }

    let param = proposal_result.data.params;
    console.log(`Please check proposal ${proposal_id} parameters:`, param);

    let confirm = await rl.question(`Do you confirm to vote ${vote?"support":"reject"} for propose ${proposal_id}? (y/n): `);
    if (confirm !== 'y' && confirm !== 'yes') {
        console.log("Vote cancelled.");
        return;
    }

    let params = parseParams(param);

    if (vote) {
        console.log(`Supporting proposal ${proposal_id}...`);
        let txresp = await committee.support(proposal_id, params);
        console.log(`Waiting Transaction hash ${txresp.hash} on the chain`);
        await txresp.wait();
        console.log(`Successfully supported proposal ${proposal_id}.`);
    } else {
        console.log(`Rejecting proposal ${proposal_id}...`);
        let txresp = await committee.reject(proposal_id, params);
        console.log(`Waiting Transaction hash ${txresp.hash} on the chain`);
        await txresp.wait();
        console.log(`Successfully rejected proposal ${proposal_id}.`);
    }
}

vote().then(() => {
    console.log("vote finished.");
    exit(0);
})