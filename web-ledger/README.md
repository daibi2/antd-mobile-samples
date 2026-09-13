# antd-mobile 记账工具（web-ledger）

本示例在仓库现有 **React + antd-mobile@2** 的 Web 示例风格上，补齐一个可本地运行的记账应用：

- 用户注册 / 登录（HttpOnly Cookie 会话，密码用 bcrypt 哈希后写入数据库）
- 收支记录增删改查，数据按用户隔离
- 收入 / 支出 / 结余汇总
- SQLite 持久化（Node.js 内置 `node:sqlite`，库文件默认在 `data/ledger.db`）

现有 `web-webpack3` / `create-react-app` 等示例只有前端演示，没有服务端与数据库，因此单独放在 `web-ledger/`，避免改动其它 sample。

## 环境

- Node.js 22+（使用内置 SQLite）
- npm 3+

## Install & Start

```shell
cd web-ledger
npm i
npm test
npm start
```

打开 http://localhost:8000/

首次启动会执行 webpack 打包，然后由 Express 同时提供页面和 `/api/*`。

开发时若只改了服务端，可在已经 `npm run build` 后执行：

```shell
node server/index.js
```

可选环境变量：

- `PORT` 端口，默认 `8000`
- `LEDGER_DB` SQLite 路径，默认 `web-ledger/data/ledger.db`（该目录已 gitignore）

不要把数据库文件或自定义密钥提交进仓库。

## 使用说明

1. 打开首页，切换「注册」创建账号（用户名 3-32 位字母数字下划线，密码至少 8 位），会自动登录。
2. 点「记一笔」选择收入或支出、金额、分类、日期和备注后保存。
3. 列表左滑可编辑或删除；顶部展示当前用户的收入、支出、结余。
4. 「退出」会清除服务端会话。

金额在库中以整数「分」存储，避免浮点误差。

## 主要结构

```
web-ledger/
  server/app.js     Express API、会话鉴权、按 user_id 隔离
  server/db.js      SQLite schema
  server/index.js   本地启动入口
  src/              antd-mobile 页面（登录 / 账单 / 表单）
  test/api.test.js  API 测试（注册登录、CRUD、隔离、汇总）
```

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/register` | 注册并建立会话 |
| POST | `/api/login` | 登录 |
| POST | `/api/logout` | 退出 |
| GET | `/api/me` | 当前用户 |
| GET | `/api/records` | 当前用户账单 |
| POST | `/api/records` | 新增 |
| PUT | `/api/records/:id` | 更新（仅本人） |
| DELETE | `/api/records/:id` | 删除（仅本人） |
| GET | `/api/summary` | 收入 / 支出 / 结余 |
