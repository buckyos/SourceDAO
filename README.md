# SourceDAO
该仓库依赖node v22以上版本，推荐使用最新LTS

This repository requires Node.js v22 or higher, with the latest LTS version recommended.

## 如何投票
1. 克隆此仓库`https://github.com/buckyos/SourceDAO`到本地
2. 在仓库根目录下执行`npm i`
3. 编辑hardhat.config.ts文件，在`networks`字段下添加opmain网络的endpoint和投票的私钥。有多个私钥的情况，投票的私钥需要放在第一位
   ````javascript
   networks: {
        opmain: {
            url: "your opmain endpoint url",
            accounts: [
                "your private key, begin with 0x",
            ]
        }
    },
   ````
4. 在根目录执行`npx hardhat run vote.ts --network opmain`
5. 等待连接网络，并检查输出的签名地址是否正确
6. 输入要投票的提案id
7. 检查提案的通用属性是否正确
8. 输入支持/反对该提案，支持输入s，反对输入r
9. 检查从后台返回的提案参数，输入y确定提交
10. 等待提交上链，程序正常退出即可

## How to Vote
1. Clone this repository `https://github.com/buckyos/SourceDAO` to your local machine
2. Run `npm i` in the repository root directory
3. Edit the hardhat.config.ts file, add the opmain network endpoint and voting private key under the `networks` field. If you have multiple private keys, the voting private key should be placed first
   ````javascript
   networks: {
        opmain: {
            url: "your opmain endpoint url",
            accounts: [
                "your private key, begin with 0x",
            ]
        }
    },
   ````
4. Run `npx hardhat run vote.ts --network opmain` in the root directory
5. Wait for network connection and verify that the output signing address is correct
6. Enter the proposal ID you want to vote on
7. Check if the general properties of the proposal are correct
8. Enter support/oppose for the proposal: enter 's' for support, 'r' for oppose
9. Check the proposal parameters returned from the backend, enter 'y' to confirm submission
10. Wait for on-chain submission, the program will exit normally when completed
