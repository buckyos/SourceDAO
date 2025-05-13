# 新的SourceDao逻辑

## Token
SourceDao有两种Token:
### DevToken
- 唯一能直接得到的Token
- 只能通过项目结算(dev合约)得到
- token有上限
- 精度18
- 不可以转账。唯一的"转账"行为发生在项目结算(token->dev)和贡献提取(dev->开发者)的时候

### NormalToken
- 只能通过DevToken 1:1兑换得到
- 可以自由转账
- 不需要单独设置上限
- 精度18
- 全员投票时，一个NormalToken算作1票

## 委员会
- 全员投票时，一个DevToken的权重算作N个NormalToken
- 权重通过委员会提案修改

## 收购合约
- 任何人都可以开启一个"收购", 用任意Token收购NormalToken
- 收购的逻辑和现在的"两步投资"合约是相同的
- 
## 项目合约
- 和现在的dev合约逻辑相同

## 分红合约
- 和现在的分红合约逻辑相同

## 锁定合约
- 使用transfer_and_lock逻辑
- 转入即为锁定状态
- 通过提案手工解锁，按人解锁
- 解锁后，分6个月线性释放


### 迁移逻辑
迁移时，所有开发者的Token都会迁移成DevToken，其他Token迁移成NormalToken