## Committee Contracts

### Purpose
A committee contract provides for the operation of standardized proposals, including proposal creation, proposal voting, and proposal settlement.

At the same time, committee contracts can also manage committee members. Managing committee actions also relies on standard proposals.

Finally, the committee contract provides some special interfaces for specific logic when the contract is upgraded.

### Proposal Interface
The standard procedure for using the proposal interface is as follows:
1. In other contracts, two interfaces are required for each action that relies on a proposal: PrepareAction(), and Action().
2. PrepareAction is used to record parameters and initiate a proposal. In this interface, propose() needs to be called, and the returned ids can be logged internally or output in logs
3. wait for the proposal to vote
4. after the vote is completed, call the Action interface, complete the specific operation
5. in the Action interface, you need to call the taskResult interface to get the status of the proposal, and at the same time verify the parameters.
6. If the status of the proposal is passed, perform the corresponding operation.
7. After the operation is executed, call setProposalExecuted interface to set the proposal as executed to avoid the proposal ID being reused maliciously.

#### propose(uint duration, bytes32[] memory params) external returns (uint proposalId)
Create a committee vote
- duration: Maximum duration of the vote in seconds. It is calculated from the block time of the transaction
- params: the hash value of the custom params, the contract will store the Merkel root of params
- proposalId: when called from within contract, returns the ID of the contract created

#### fullPropose(uint endBlockNumber, bytes32[] memory params, uint threshold) external returns (uint proposalId)
Create a full vote, full votes only can be settled after the deadline
- endBlockNumber: the specific deadline block number
- params: the hash value of the custom parameter, the contract will store the Merkel root of the params
- threshold: minimum voting threshold in 1%. The total number of votes must be greater than the threshold for the vote to be valid.
- proposalId: when called from within contract, return the ID of the created contract.

#### support(uint proposalId) external
Vote for a proposal, each proposal can only be voted once, it cannot be changed.
- proposalId: ID of the proposal

#### reject(uint proposalId) external
Vote against a proposal, each proposal can only be voted once, it cannot be changed.
- proposalId: proposalId

#### settleProposal(uint proposalId) external returns (ProposalResult)
Settle a proposal for committee voting, the settlement rules are as follows:  
- If the proposal has already been settled, the result will be returned directly. It will not be settled again.
- The members of the Committee at the time of the settlement are the valid voters
- If more than half of the committee members support the proposal, the proposal is approved.
- If more than half of the committee members reject the proposal, the proposal is rejected.
- If neither the support nor the reject votes exceed half of the total number of members, and the validity period of the vote is exceeded, the proposal is expired.
- If the number of votes for and against the proposal does not exceed half of the total number of members, and the validity period of the vote has not been exceeded, the proposal will not be decided.

#### takeResult(uint proposalId, bytes32[] memory params) public returns (ProposalResult)
Validates the parameters and returns the proposal result. If the proposal is not settled, attempt a committee proposal settlement operation

#### endFullPropose(uint proposalId, address[] memory voters) external
Performs a full-propose proposal settlement
- proposalId: proposal ID
- voters: addresses of the voters to be settled for this transaction

The settlement logic is as follows:
- endFullPropose can only be called on a full vote
- endFullPropose can only be called after vote deadline
- It can be called several times until all voter addresses have been passed in and the proposal is finally settled.
- The number of votes for each voter is equal to the total number of Token in circulation at the moment of settlement.
- If the total number of votes is less than the set threshold * the total number of active tokens, the proposal will be expired.
- If the total number of votes is not less than the set threshold * the total number of active tokens, the proposal will be passed or rejected according to the majority of the votes.

#### setProposalExecuted(uint proposalId) external
Set the proposal as executed.
- Only approved proposals can set the executed status.
- Only the creator of a proposal can set the executed status of this proposal.
- Only the creator of the proposal can set the executed status of the proposal. If the proposal was created by a contract, only the code of the contract can set the executed status.

#### proposalOf(uint proposalId) external view returns (Proposal memory)
Returns information about a proposal

### Committee interface
#### isMember(address someOne) external view returns (bool)
Determines if someone is a member of a committee

#### members() external view returns (address[] memory)
Returns all current committee members

#### prepareAddMember(address member) external returns (uint)
Initiate a proposal to add a committee member, returns the id of the proposal

#### addCommitteeMember(address member, uint proposalId)
Add committee member, the member passed in here and the ID returned by prepareAddMember must correspond, otherwise the execution fails.

#### prepareRemoveMember(address member) external returns (uint)
Initiate a proposal to remove a committee member, return the id of the proposal

#### removeCommitteeMember(address member, uint proposalId)
Remove a committee member, the member passed in here must correspond to the ID returned by prepareAddMember, otherwise the execution fails.

### Contract Upgrade Interface
#### prepareContractUpgrade(address proxyContractAddress, address newImplementAddress) external returns (uint)
Initiates a contract upgrade proposal.
- proxyContractAddress: address of the contract agent to be upgraded.
- newImplementAddress: the address of the new contract implementation.
- Only committee members can initiate contract upgrade proposals
- A contract can only have one upgrade proposal at a time

#### cancelContractUpgrade(address proxyContractAddress) external
cancelContractUpgrade(address proxyContractAddress): cancel a contract upgrade proposal.
- proxyContractAddress: the address of the proxy of the contract to be upgraded.
- Only committee members can cancel an upgrade proposal
- Accepted upgrade proposals cannot be canceled