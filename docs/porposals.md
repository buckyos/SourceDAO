### Add member

Parameters|Type|Description
---|---|---
Address|Address|of the member to add
ProposalType|bytes32|"addMember"

### Remove member

Parameters|type|description
---|---|---
Address|Address|of the member to remove
ProposalType|bytes32|"removeMember"

### Contract upgrade
Parameters|Type|Description
---|---|---
Proxy Address|Address|Proxy address of the contract
NewImplementationAddress|Address|new implementation address of the contract
ProposalType|bytes32|"upgradeContract"

### Setting up the committee wallet
Parameters|type|description
---|---|---
WalletAddress|Address|address of the wallet to be set up
ProposalType|bytes32|"committeeWallet"

### Set the asset wallet
Parameters|type|description
---|---|---
WalletAddress|Address|Address of the wallet to set up
ProposalType|bytes32|"assetWallet"

### Set income wallet
Parameters|type|description
---|---|---
WalletAddress|Address|Address of the wallet to set up
ProposalType|bytes32|"incomeWallet"

### Create project
Parameters|Type|Description
---|---|---
projectId|uint|projectId
budget|uint|projectBudget
startDate|uint|project start time
endDate|uint|project end time
ProposalType|bytes32|"createProject"

### Close the project
Parameters|type|description
---|---|---
projectId|uint|Project ID
budget|uint|project budget
startDate|uint|project start time
endDate|uint|project end time
proposalType|bytes32|"acceptProject"

### Open investment
Parameters|type|description
---|---|---
investmentId|uint|investmentId
totalTokenAmount|uint|
priceType|uint
tokenExchangeRate|uint
assetExchangeRate|uint
startTime|uint
endTime|uint
goalAssetAmount|uint|
minAssetPerInvestor|uint
maxAssetPerInvestor|uint
assetAddress|address|
onlyWhitelist|uint|
ProposalType|bytes32|"createInvestment"

### Terminate investment
Parameters|type|description
---|---|---
investmentId|uint|investmentId
refund|uint|
ProposalType|bytes32|"abortInvestment"

### Create market campaign
Parameters|type|description
---|---|---
budget|uint|
reward|uint|
startDate|uint|
endDate|uint
ProposalType|bytes32|"createActivity"

### Settle market activity
Parameters|type|description
---|---|---
budget|uint|
reward|uint|
startDate|uint|
endDate|uint|
ProposalType|bytes32|"evaluateActivity"

### Multi-signature transfer
Parameters|type|description
---|---|---
token|Address|Token address
to|Address|The address to transfer to
amount|uint|amount
name|bytes32|`keccak256(abi.encodePacked(wallet name))`
proposalType|bytes32|"walletTransfer"

### Release Token
Parameters|type|description
---|---|---
hash[]|bytes32|per pair of owners and amounts, encoded with `keccak256(abi.encodePacked(owners[i], amounts[i]))`
ProposalType|bytes32|"releaseTokens"

### Dividend wallet conversion state
Parameters|type|description
---|---|---
state|uint|state to switch to
blockNumber|uint|starting block number
proposalType|bytes32|"divideChangeState"

### Lock Token
Parameters|type|description
---|---|---
hash[]|bytes32|per pair of owners and amounts, encoded with `keccak256(abi.encodePacked(owners[i], amounts[i]))`
ProposalType|bytes32|"depositTokens"

### Unlock Token
Parameters|type|description
---|---|---
hash[]|bytes32|per pair of owners and amounts, encoded with `keccak256(abi.encodePacked(owners[i], amounts[i]))`
ProposalType|bytes32|"unlockTokens"