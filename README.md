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
4. 推荐执行`npx hardhat run tools/vote.ts --network opmain`
5. 根目录的`vote.ts`仍保留兼容入口，但后续建议统一使用`tools/vote.ts`
6. 更完整的使用说明、支持范围、风险说明和故障排查见[docs/VoteTool.md](docs/VoteTool.md)

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
4. Prefer running `npx hardhat run tools/vote.ts --network opmain`
5. The root `vote.ts` remains as a compatibility entrypoint, but new usage should target `tools/vote.ts`
6. See [docs/VoteTool.md](docs/VoteTool.md) for detailed usage, supported proposal types, limitations, and troubleshooting
