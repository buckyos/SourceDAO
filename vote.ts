import { exit } from "node:process";
import readline from "node:readline/promises";

import { ethers, network } from "hardhat";
import { HttpNetworkConfig } from "hardhat/types";
import { sign } from "node:crypto";

const MAIN_ADDRESS = "0x191Af8663fF88823d6b226621DC4700809D042fa"; // opmain main contract address

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
    console.log(`Propoal ${proposal_id} info:`)
    console.log(`\torigin: ${proposeInfo.origin}`);
    console.log(`\State: ${proposeInfo.state}`);
    console.log(`\expired at: ${new Date(Number(proposeInfo.expired) * 1000).toLocaleString()}`);

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

    let paramStr = await rl.question("Please input the parameters for the vote: ");
    let params = JSON.parse(paramStr);

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