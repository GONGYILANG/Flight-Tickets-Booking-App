# Flight Booking AI 中间层

该目录把前端聊天消息转换为 DeepSeek strict tool calls，再调用现有 Node.js REST API。支持：

- 城市或机场自然语言解析：`GET /api/airports/search`
- 航班查询：`GET /api/flights/search`
- 航班详情复核：`GET /api/flights/:flightId`
- AI 来源预订：`POST /api/bookings`
- 查询本人订单：`GET /api/bookings/me`
- 取消订单：`PATCH /api/bookings/:bookingId/cancel`

## 文件职责

- `resolution.py`：定义 DeepSeek JSON Schema、严格校验模型参数、调用后端，并循环处理多轮 tool calls。
- `app.py`：提供前端 HTTP 接口、维护会话、转发登录 Token，并处理请求幂等性。
- `tests/`：在不连接 DeepSeek、MongoDB 或 Node.js 服务的情况下测试参数映射、幂等键和工具循环。

## 安装与启动

先启动 `backend`，确保默认地址 `http://localhost:3000` 可访问。然后在 `middle` 目录创建虚拟环境并安装依赖：

```powershell
cd D:\FYP\FlightBooking\middle
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

编辑 `.env`，至少设置真实的 `DEEPSEEK_API_KEY`。启动中间层：

```powershell
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Swagger 页面位于 `http://127.0.0.1:8000/docs`，健康检查为 `GET /health`。

也可不用前端直接运行终端聊天；需要预订或取消时，可临时把已登录用户的 JWT 放在 `BACKEND_ACCESS_TOKEN` 环境变量中：

```powershell
python resolution.py
```

## 前端接口

第一次发送消息：

```http
POST /api/chat
Content-Type: application/json
Authorization: Bearer <accessToken>

{
  "message": "帮我找 2026-12-08 上午从北京到香港的两张最便宜机票"
}
```

响应：

```json
{
  "sessionId": "d15ed6e0-e750-4af7-b284-001462f33279",
  "requestId": "a3bbb0e4-3750-49af-b539-4b5ac85c331e",
  "message": "……",
  "replayed": false,
  "events": [
    {
      "tool": "search_flights",
      "result": {
        "ok": true,
        "status": 200,
        "data": { "flights": [] }
      }
    }
  ]
}
```

`events` 按调用顺序包含安全的公开工具结果，供前端渲染机场、航班和订单卡片；不会包含 JWT、模型推理或工具调用 ID。旧客户端可忽略该附加字段。

后续消息必须复用 `sessionId`，这样模型才能理解“订第一个”等上下文：

```json
{
  "sessionId": "d15ed6e0-e750-4af7-b284-001462f33279",
  "requestId": "由前端为这一次用户操作生成的新 UUID",
  "message": "确认预订第一个航班，两张"
}
```

所有聊天和删除会话请求都要把后端登录接口返回的 JWT 交给中间层：

```http
Authorization: Bearer <accessToken>
```

Token 只由 Python 代码转发给 Node.js 后端，不会进入 DeepSeek 的 `messages`、tool schema 或 tool result。

## 幂等与会话约定

- 前端应为每一次用户操作生成一个 UUID `requestId`；同一个 HTTP 请求超时重试时必须复用它。
- 中间层使用 `requestId + flightId + seatCount` 生成后端 `idempotencyKey`。重复请求不会再次扣座。
- 同一个 `sessionId + requestId` 再次提交相同消息时直接返回缓存响应；同一 ID 配不同消息返回 `409 REQUEST_ID_CONFLICT`。
- 会话默认保留 1 小时。当前存储在单个 Python 进程内，因此请使用一个 Uvicorn worker。多实例部署时应把会话和响应缓存迁移到 Redis 等共享存储。
- `DELETE /api/chat/{sessionId}` 可清除会话。
- 每次 HTTP 请求（包括缓存重放和清除会话）先用 `GET /api/auth/me` 验证 JWT；被撤销、过期或停用的凭证无法读取缓存。会话和删除操作按已验证的用户 ID 隔离。

## 安全边界

模型生成的 JSON 即使处于 strict 模式，也会再次接受本地类型、范围、日期、IATA、ObjectId 和字段集合校验。预订固定使用 `source=AI`，幂等键由程序生成。系统提示要求在预订或取消前展示准确对象并取得自然语言明确确认；面向真实支付场景时，还应在前端增加独立确认按钮，而不能只依赖模型判断。

## 测试

激活已安装 `requirements.txt` 的虚拟环境后运行：

```powershell
.venv\Scripts\python -m unittest discover -s tests -v
```
