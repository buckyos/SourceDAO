# Local GitHub OAuth Testing

## 目的

这份文档用于说明如何在本地 `stack:local` 环境下，关闭 `devlogin`，改为测试完整的 GitHub 联合登录流程。

适用场景：

- 想验证 `Login with GitHub` 的完整跳转和回调
- 想验证 GitHub 登录后再执行钱包 `bind`
- 想验证 `Switch GitHub account` 行为

---

## 一、前置条件

需要本地具备：

- `SourceDAO`
- `SourceDAOBackend`
- `buckydaowww`
- 可正常启动的 `stack:local`
- 一个你自己创建的 GitHub OAuth App

当前实现使用的是 GitHub OAuth App，不需要 GitHub App `App ID`。
真正需要的只有：

- `Client ID`
- `Client Secret`
- `Authorization callback URL`

---

## 二、GitHub OAuth App 如何配置

在 GitHub 网页端：

1. 打开 `Settings`
2. 进入 `Developer settings`
3. 选择 `OAuth Apps`
4. 点击 `New OAuth App`

本地联调用推荐配置：

- `Application name`
  - 例如：`SourceDAO Local Dev`
- `Homepage URL`
  - `http://127.0.0.1:3000/`
- `Authorization callback URL`
  - `http://127.0.0.1:3000/login`

创建完成后，记录：

- `Client ID`
- `Client Secret`

注意：

- 本地建议统一使用 `127.0.0.1`，不要混用 `localhost`
- `Authorization callback URL` 必须和 backend 实际使用的 `github_callback_url` 保持一致

---

## 三、本地联调要设置的环境变量

本地 `stack:local` 下，不要手改生成后的配置文件，而是通过环境变量覆盖。

关键环境变量如下：

- `SOURCE_DAO_BACKEND_GITHUB_CLIENT_ID`
- `SOURCE_DAO_BACKEND_GITHUB_CLIENT_SECRET`
- `SOURCE_DAO_BACKEND_GITHUB_CALLBACK_URL`
- `SOURCE_DAO_BACKEND_ALLOW_DEV_LOGIN`
- `SOURCE_DAO_LOCAL_AUTH_MODE`

推荐启动方式：

```bash
export SOURCE_DAO_BACKEND_GITHUB_CLIENT_ID='你的 GitHub Client ID'
export SOURCE_DAO_BACKEND_GITHUB_CLIENT_SECRET='你的 GitHub Client Secret'
export SOURCE_DAO_BACKEND_GITHUB_CALLBACK_URL='http://127.0.0.1:3000/login'
export SOURCE_DAO_BACKEND_ALLOW_DEV_LOGIN='false'
export SOURCE_DAO_LOCAL_AUTH_MODE='github'

cd /home/bucky/work/SourceDAO
npm run stack:local:stop
npm run stack:local
```

这些变量的作用分别是：

- `SOURCE_DAO_BACKEND_GITHUB_CLIENT_ID`
  - 写入 backend 生成的 `config.local.toml`
- `SOURCE_DAO_BACKEND_GITHUB_CLIENT_SECRET`
  - 写入 backend 生成的 `config.local.toml`
- `SOURCE_DAO_BACKEND_GITHUB_CALLBACK_URL`
  - 控制 backend 发起 GitHub authorize/token exchange 时使用的 callback URL
- `SOURCE_DAO_BACKEND_ALLOW_DEV_LOGIN='false'`
  - 强制关闭 `/user/devlogin`
- `SOURCE_DAO_LOCAL_AUTH_MODE='github'`
  - 告诉前端本地模式下不要走 `devlogin`，而是显示 `Login with GitHub`

---

## 四、为什么不要直接手改 config.local.toml

`stack:local` 在启动 backend 时，会调用：

- [`SourceDAOBackend/scripts/backend_local_dev.sh`](/home/bucky/work/SourceDAOBackend/scripts/backend_local_dev.sh)

这个脚本会重新生成：

- [`SourceDAOBackend/src/config.local.toml`](/home/bucky/work/SourceDAOBackend/src/config.local.toml)

所以如果你只是手改 `config.local.toml`，下一次 `stack:local` 启动时它可能被覆盖。

本地 GitHub 登录联调应以环境变量为准，而不是依赖手工修改生成文件。

---

## 五、启动后应该看到什么

成功启动后，前端应显示：

- 本地链仍然是 `31337`
- 登录按钮文案变成 `Login with GitHub`

而不是：

- `Login with Wallet`

如果按钮文案仍然不对，优先检查：

- `SOURCE_DAO_LOCAL_AUTH_MODE='github'` 是否已生效
- 前端是否已经重启

---

## 六、完整测试步骤

### 1. 测试正常 GitHub 登录

1. 打开 `http://127.0.0.1:3000`
2. 点击 `Login with GitHub`
3. 浏览器应跳转到 GitHub 授权页
4. GitHub 授权后，浏览器回到：
   - `http://127.0.0.1:3000/login?...`
5. 前端再请求 backend 完成登录
6. 如果当前钱包尚未绑定，会继续触发钱包签名并执行 `bind`

成功后应看到：

- 已登录的用户信息
- 绑定地址显示正常

### 2. 测试地址切换后的提示

1. 用钱包 `A` + GitHub 账号 `G1` 登录并绑定
2. 执行站内 `logout`
3. 把浏览器钱包切换到地址 `B`
4. 再次点击 `Login with GitHub`

如果 GitHub 复用了上一次会话，系统可能仍然登录回 `G1`，
这时应看到：

- `Bound` 地址是 `A`
- `Active` 地址是 `B`
- 页面提示地址不一致

这属于预期行为，不是 bug。

### 3. 测试切换 GitHub 账号

在已登录状态下使用：

- `Switch GitHub account`

这条入口会重新发起 GitHub OAuth，并显式带：

- `prompt=select_account`

用于要求 GitHub 展示账号选择器。

---

## 七、排查要点

### 1. 点击登录后 GitHub URL 里还是旧的 `client_id`

优先检查：

- backend 是否已重启
- 启动前是否正确导出了 `SOURCE_DAO_BACKEND_GITHUB_CLIENT_ID`

因为 GitHub authorize URL 是 backend 生成的，不是前端硬编码的。

### 2. 点击登录后仍然走本地钱包登录

优先检查：

- `SOURCE_DAO_LOCAL_AUTH_MODE='github'`
- 前端是否已重启

### 3. 登录成功后又弹错误

之前最常见的问题是重复消费同一个 GitHub `code`。
当前代码已经做了防重，但如果你看到新的错误，优先检查：

- backend 日志
- 浏览器 Network 面板里的 `/api/user/githublogin`

### 4. `Switch GitHub account` 看起来没有停留在 GitHub 页面

先确认：

- backend 是否已重启
- 跳转到 GitHub 的 authorize URL 里是否真的包含 `prompt=select_account`

如果包含该参数，但仍然很快自动回跳，通常是因为浏览器里只有一个 GitHub 会话，
或者这个 OAuth App 已经被授权过。

---

## 八、相关文档

- 本地全栈启动：
  [`LocalFullStackDev.md`](/home/bucky/work/SourceDAO/docs/LocalFullStackDev.md)
- backend 本地启动：
  [`SourceDAOBackend/doc/BackendLocalRun.md`](/home/bucky/work/SourceDAOBackend/doc/BackendLocalRun.md)
- backend 鉴权模型：
  [`SourceDAOBackend/doc/BackendAuthAndDevLogin.md`](/home/bucky/work/SourceDAOBackend/doc/BackendAuthAndDevLogin.md)
