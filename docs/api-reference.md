# Flight Booking Backend API Reference

本文件描述当前 `backend/src` 实现的 HTTP API，供 Android 客户端、Thunder Client 测试，以及未来的 AI 工具调用使用。

默认本地服务地址：

```text
http://localhost:3000
```

除健康检查外，所有 JSON 请求都应携带：

```http
Content-Type: application/json
```

## API 概览

| 模块 | 方法 | 路径 | 需要登录 |
| --- | --- | --- | --- |
| 健康检查 | `GET` | `/api/health` | 否 |
| 认证 | `POST` | `/api/auth/register` | 否 |
| 认证 | `POST` | `/api/auth/login` | 否 |
| 认证 | `GET` | `/api/auth/me` | 是 |
| 机场 | `GET` | `/api/airports/search` | 否 |
| 航班 | `GET` | `/api/flights/search` | 否 |
| 航班 | `GET` | `/api/flights/:flightId` | 否 |
| 订单 | `POST` | `/api/bookings` | 是 |
| 订单 | `GET` | `/api/bookings/me` | 是 |
| 订单 | `PATCH` | `/api/bookings/:bookingId/cancel` | 是 |

## 通用约定

### 认证

需要登录的端点使用 JWT Bearer Token：

```http
Authorization: Bearer <accessToken>
```

`accessToken` 由注册或登录接口返回。缺少、过期或无效的 Token 会返回 `401`；被停用或锁定的用户会返回 `403`。

### 时间与时区

- 所有响应中的时间均为 ISO 8601 UTC 字符串，例如 `2026-12-08T00:30:00.000Z`。
- 航班搜索中的 `departureDate` 是**出发机场当地日期**，并非 UTC 日期。
- `departurePeriod` 也按出发机场的 IANA 时区解释：
  - `MORNING`：当地 `00:00`（含）至 `12:00`（不含）；
  - `AFTERNOON`：当地 `12:00`（含）至次日 `00:00`（不含）；
  - 未传入：搜索该当地日期全天。

### 金额

- 币种固定为 USD。
- API 中的金额使用固定两位小数的**字符串**，例如 `"325.00"`，以避免客户端浮点误差。
- `Flight.price` 是当前航班的单座展示价。
- `Booking.pricing` 是创建订单时保存的价格快照；航班之后调价不会改变已有订单的 `pricing`。

### 分页

航班和订单列表均返回：

```json
{
  "page": 1,
  "limit": 20,
  "totalItems": 42,
  "totalPages": 3
}
```

页码从 `1` 开始。

### 通用错误格式

错误响应统一使用：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "One or more request parameters are invalid",
    "details": {
      "fields": [
        {
          "field": "origin",
          "message": "origin must be a three-letter IATA airport code"
        }
      ]
    }
  }
}
```

`details.fields` 只会在字段或查询参数校验失败时出现。

## 数据对象

### User

```json
{
  "id": "66a1b2c3d4e5f67890123456",
  "email": "student@example.com",
  "displayName": "Student",
  "status": "ACTIVE"
}
```

`status` 的可能值为 `ACTIVE`、`LOCKED`、`DISABLED`。

### Airport

```json
{
  "id": "66a1b2c3d4e5f67890123456",
  "iataCode": "PEK",
  "name": "Beijing Capital International Airport",
  "cityName": "Beijing",
  "countryCode": "CN",
  "timezone": "Asia/Shanghai"
}
```

### Flight

```json
{
  "id": "66a1b2c3d4e5f67890123456",
  "flightNumber": "CX101",
  "airline": {
    "id": "66a1b2c3d4e5f67890120001",
    "code": "CX",
    "name": "Cathay Pacific"
  },
  "originAirport": {
    "id": "66a1b2c3d4e5f67890120002",
    "iataCode": "PEK",
    "name": "Beijing Capital International Airport",
    "cityName": "Beijing",
    "countryCode": "CN",
    "timezone": "Asia/Shanghai"
  },
  "destinationAirport": {
    "id": "66a1b2c3d4e5f67890120003",
    "iataCode": "HKG",
    "name": "Hong Kong International Airport",
    "cityName": "Hong Kong",
    "countryCode": "HK",
    "timezone": "Asia/Hong_Kong"
  },
  "departureAt": "2026-12-08T00:30:00.000Z",
  "arrivalAt": "2026-12-08T04:00:00.000Z",
  "durationMinutes": 210,
  "price": {
    "amount": "380.00",
    "currency": "USD"
  },
  "totalSeats": 180,
  "availableSeats": 42,
  "status": "SCHEDULED"
}
```

航班 `status` 的可能值为 `SCHEDULED`、`DELAYED`、`CANCELLED`、`DEPARTED`、`ARRIVED`。只有尚未起飞且状态为 `SCHEDULED` 或 `DELAYED` 的航班可被预订。

### Booking

```json
{
  "id": "66a1b2c3d4e5f67890123499",
  "bookingReference": "BK1A2B3C4D5E6",
  "flight": { "...": "完整 Flight 对象" },
  "seatCount": 2,
  "pricing": {
    "unitAmount": "380.00",
    "totalAmount": "760.00",
    "currency": "USD"
  },
  "source": "UI",
  "status": "CONFIRMED",
  "createdAt": "2026-08-24T10:00:00.000Z",
  "updatedAt": "2026-08-24T10:00:00.000Z",
  "cancelledAt": null
}
```

- `source`：`UI` 或 `AI`。
- `status`：`CONFIRMED` 或 `CANCELLED`。
- `flight` 是完整的公开 Flight 对象；不会返回用户 ID、密码、`idempotencyKey`、内部美分字段或 Mongoose 内部字段。

## 健康检查

### `GET /api/health`

检查 HTTP 服务与 MongoDB 连接状态，无需认证。

成功时返回 `200`：

```json
{
  "status": "ok",
  "timestamp": "2026-08-24T10:00:00.000Z",
  "uptimeSeconds": 3600,
  "database": {
    "status": "connected",
    "name": "flightBookingDB"
  }
}
```

数据库不可用时返回 `503`，`status` 为 `"unavailable"`。

## 认证 API

### `POST /api/auth/register`

创建用户并立即返回登录 Token，无需认证。

请求体：

```json
{
  "email": "student@example.com",
  "password": "correct-horse-battery-staple",
  "displayName": "Student"
}
```

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `email` | 是 | 合法邮箱格式；会去除首尾空格并转为小写；最多 320 个字符。 |
| `password` | 是 | UTF-8 字节长度为 8–72。 |
| `displayName` | 是 | 去除首尾空格后长度为 2–120。 |

成功返回 `201`：

```json
{
  "data": {
    "user": {
      "id": "66a1b2c3d4e5f67890123456",
      "email": "student@example.com",
      "displayName": "Student",
      "status": "ACTIVE"
    },
    "accessToken": "<JWT>",
    "tokenType": "Bearer",
    "expiresIn": "2h"
  }
}
```

常见错误：

- `400 INVALID_REQUEST`：字段缺失或不符合规则。
- `409 EMAIL_ALREADY_REGISTERED`：邮箱已注册。

### `POST /api/auth/login`

使用邮箱和密码登录，无需认证。

请求体：

```json
{
  "email": "student@example.com",
  "password": "correct-horse-battery-staple"
}
```

字段规则与注册接口中的 `email`、`password` 相同。

成功返回 `200`，`data` 格式与注册接口完全相同。

常见错误：

- `400 INVALID_REQUEST`：字段缺失或格式不正确。
- `401 INVALID_CREDENTIALS`：邮箱不存在或密码错误。
- `403 ACCOUNT_NOT_ACTIVE`：用户不是 `ACTIVE` 状态。

### `GET /api/auth/me`

读取当前登录用户。

认证：需要 Bearer Token。

成功返回 `200`：

```json
{
  "data": {
    "user": {
      "id": "66a1b2c3d4e5f67890123456",
      "email": "student@example.com",
      "displayName": "Student",
      "status": "ACTIVE"
    }
  }
}
```

## 机场 API

### `GET /api/airports/search`

按 IATA 代码、机场名称或城市名称搜索机场。出发地和目的地输入框共用此接口；用户最终应选择一个具体机场代码。

查询参数：

| 参数 | 必填 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `q` | 是 | — | 1–80 个字符；不区分大小写。 |
| `limit` | 否 | `10` | 整数，范围 `1–20`。 |

示例：

```http
GET /api/airports/search?q=beijing&limit=10
```

成功返回 `200`：

```json
{
  "data": {
    "airports": [
      {
        "id": "66a1b2c3d4e5f67890120002",
        "iataCode": "PEK",
        "name": "Beijing Capital International Airport",
        "cityName": "Beijing",
        "countryCode": "CN",
        "timezone": "Asia/Shanghai"
      },
      {
        "id": "66a1b2c3d4e5f67890120004",
        "iataCode": "PKX",
        "name": "Beijing Daxing International Airport",
        "cityName": "Beijing",
        "countryCode": "CN",
        "timezone": "Asia/Shanghai"
      }
    ]
  }
}
```

结果会优先排列完全匹配的 IATA 代码、IATA 前缀、城市完全匹配、城市前缀和机场名前缀。参数不合法时返回 `400 INVALID_REQUEST`。

## 航班 API

### `GET /api/flights/search`

按具体出发机场、到达机场和出发日期搜索可预订的直飞航班。搜索结果只包含 `SCHEDULED` 或 `DELAYED` 状态、且余票不少于 `passengers` 的航班。

查询参数：

| 参数 | 必填 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `origin` | 是 | — | 三位 IATA 机场代码，例如 `PEK`。自动转为大写。 |
| `destination` | 是 | — | 三位 IATA 机场代码，例如 `HKG`；不可与 `origin` 相同。 |
| `departureDate` | 是 | — | 有效日期，格式 `YYYY-MM-DD`；按出发机场当地日期解释。 |
| `departurePeriod` | 否 | `null` | `MORNING`、`AFTERNOON`；不传则搜索全天。自动转为大写。 |
| `airlineCode` | 否 | `null` | 2–3 位航空公司代码，例如 `CX`；必须对应一个启用中的航空公司。自动转为大写。 |
| `passengers` | 否 | `1` | 整数，范围 `1–9`；结果必须有足够余票。 |
| `page` | 否 | `1` | 整数，范围 `1–10000`。 |
| `limit` | 否 | `20` | 整数，范围 `1–50`。 |
| `sortBy` | 否 | `departureAt` | `departureAt`、`arrivalAt`、`availableSeats` 或 `price`。 |
| `sortOrder` | 否 | `asc` | `asc` 或 `desc`；不区分大小写。 |

价格排序中的公开参数 `sortBy=price` 会在数据库中按内部美分字段排序，但 API 不会暴露该内部字段。相同排序值会使用航班 ID 作为稳定的次级排序条件。

示例：

```http
GET /api/flights/search?origin=PEK&destination=HKG&departureDate=2026-12-08&departurePeriod=MORNING&airlineCode=CX&passengers=2&sortBy=price&sortOrder=asc&page=1&limit=20
```

成功返回 `200`：

```json
{
  "data": {
    "flights": [
      {
        "id": "66a1b2c3d4e5f67890123456",
        "flightNumber": "CX101",
        "airline": {
          "id": "66a1b2c3d4e5f67890120001",
          "code": "CX",
          "name": "Cathay Pacific"
        },
        "originAirport": {
          "id": "66a1b2c3d4e5f67890120002",
          "iataCode": "PEK",
          "name": "Beijing Capital International Airport",
          "cityName": "Beijing",
          "countryCode": "CN",
          "timezone": "Asia/Shanghai"
        },
        "destinationAirport": {
          "id": "66a1b2c3d4e5f67890120003",
          "iataCode": "HKG",
          "name": "Hong Kong International Airport",
          "cityName": "Hong Kong",
          "countryCode": "HK",
          "timezone": "Asia/Hong_Kong"
        },
        "departureAt": "2026-12-08T00:30:00.000Z",
        "arrivalAt": "2026-12-08T04:00:00.000Z",
        "durationMinutes": 210,
        "price": {
          "amount": "380.00",
          "currency": "USD"
        },
        "totalSeats": 180,
        "availableSeats": 42,
        "status": "SCHEDULED"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 1,
      "totalPages": 1
    },
    "search": {
      "origin": "PEK",
      "destination": "HKG",
      "departureDate": "2026-12-08",
      "departurePeriod": "MORNING",
      "departureTimezone": "Asia/Shanghai",
      "airlineCode": "CX",
      "passengers": 2,
      "sortBy": "price",
      "sortOrder": "asc"
    }
  }
}
```

常见错误：

- `400 INVALID_REQUEST`：参数格式不正确、出发地和目的地相同、机场不存在，或 `airlineCode` 不是启用中的航空公司。
- 有效路线当天没有航班时仍返回 `200`，其中 `flights` 是空数组、`totalItems` 为 `0`。

### `GET /api/flights/:flightId`

按 MongoDB ObjectId 获取单个航班的完整公开信息。

示例：

```http
GET /api/flights/66a1b2c3d4e5f67890123456
```

成功返回 `200`：

```json
{
  "data": {
    "flight": { "...": "完整 Flight 对象" }
  }
}
```

错误：

- `400 INVALID_REQUEST`：`flightId` 不是有效 ObjectId。
- `404 FLIGHT_NOT_FOUND`：航班不存在。

## 订单 API

所有订单接口都只操作当前 Bearer Token 对应用户的订单；客户端不能通过请求体指定用户。

### `POST /api/bookings`

创建一张模拟机票订单，并原子扣减航班余票。

认证：需要 Bearer Token。

请求体：

```json
{
  "flightId": "66a1b2c3d4e5f67890123456",
  "seatCount": 2,
  "source": "UI",
  "idempotencyKey": "b6d30236-8e1f-4e75-9d5d-0d305f4a1b6e"
}
```

| 字段 | 必填 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `flightId` | 是 | — | 有效 MongoDB ObjectId。 |
| `seatCount` | 否 | `1` | 整数，范围 `1–9`。 |
| `source` | 否 | `UI` | `UI` 或 `AI`；会去除空格并转为大写。 |
| `idempotencyKey` | 是 | — | 规范 UUID；会去除空格并转为小写。 |

`idempotencyKey` 用于将网络重试、重复点击或 AI 重试识别为同一逻辑预订：

- 同一用户、相同 key、相同 `flightId`、`seatCount`、`source`：不会重复扣座，直接返回首次创建的订单。
- 同一用户、相同 key、但上述任一请求内容不同：返回 `409 IDEMPOTENCY_KEY_CONFLICT`。
- 不同用户可以使用相同 UUID。
- 客户端在同一次预订的超时或重试中必须复用原 UUID；开始一次新的预订才生成新 UUID。

首次创建成功返回 `201`：

```json
{
  "data": {
    "booking": {
      "id": "66a1b2c3d4e5f67890123499",
      "bookingReference": "BK1A2B3C4D5E6",
      "flight": { "...": "完整 Flight 对象" },
      "seatCount": 2,
      "pricing": {
        "unitAmount": "380.00",
        "totalAmount": "760.00",
        "currency": "USD"
      },
      "source": "UI",
      "status": "CONFIRMED",
      "createdAt": "2026-08-24T10:00:00.000Z",
      "updatedAt": "2026-08-24T10:00:00.000Z",
      "cancelledAt": null
    }
  },
  "meta": {
    "idempotentReplay": false
  }
}
```

幂等重放成功返回 `200`，`data.booking` 为同一张订单，且：

```json
{
  "meta": {
    "idempotentReplay": true
  }
}
```

可预订条件：航班存在、尚未起飞、状态为 `SCHEDULED` 或 `DELAYED`，且 `availableSeats >= seatCount`。

常见错误：

- `400 INVALID_REQUEST`：请求体或字段不合法。
- `401 AUTH_REQUIRED`、`INVALID_TOKEN`、`TOKEN_EXPIRED`：未通过认证。
- `409 FLIGHT_NOT_FOUND_OR_SOLD_OUT`：航班不存在、已起飞、状态不可预订或余票不足。
- `409 IDEMPOTENCY_KEY_CONFLICT`：同一用户复用了 key，但请求内容不同。
- `503 BOOKING_WRITES_PAUSED`：维护期间暂停创建和取消订单。
- `500 BOOKING_CREATION_FAILED` 或 `BOOKING_CONSISTENCY_ERROR`：服务端无法安全完成或补偿订单写入；客户端不应擅自更换 UUID，应先查询订单或使用原 UUID 重试。

### `GET /api/bookings/me`

获取当前用户的订单，不返回其他用户的订单。

认证：需要 Bearer Token。

查询参数：

| 参数 | 必填 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `page` | 否 | `1` | 整数，范围 `1–10000`。 |
| `limit` | 否 | `20` | 整数，范围 `1–50`。 |

结果按 `createdAt DESC, _id DESC` 稳定排序；当前版本不提供状态筛选。

示例：

```http
GET /api/bookings/me?page=1&limit=20
Authorization: Bearer <accessToken>
```

成功返回 `200`：

```json
{
  "data": {
    "bookings": [
      { "...": "完整 Booking 对象" }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "totalItems": 1,
      "totalPages": 1
    }
  }
}
```

### `PATCH /api/bookings/:bookingId/cancel`

取消当前用户的一张订单，并恢复相应座位数。

认证：需要 Bearer Token。

`bookingId` 必须是有效 MongoDB ObjectId。

只有满足以下条件的 `CONFIRMED` 订单可被首次取消：

- 订单属于当前用户；
- 对应航班尚未起飞；
- 航班状态为 `SCHEDULED` 或 `DELAYED`。

首次取消成功返回 `200`：

```json
{
  "data": {
    "booking": {
      "id": "66a1b2c3d4e5f67890123499",
      "bookingReference": "BK1A2B3C4D5E6",
      "flight": { "...": "完整 Flight 对象" },
      "seatCount": 2,
      "pricing": {
        "unitAmount": "380.00",
        "totalAmount": "760.00",
        "currency": "USD"
      },
      "source": "UI",
      "status": "CANCELLED",
      "createdAt": "2026-08-24T10:00:00.000Z",
      "updatedAt": "2026-08-24T10:05:00.000Z",
      "cancelledAt": "2026-08-24T10:05:00.000Z"
    }
  },
  "meta": {
    "alreadyCancelled": false
  }
}
```

重复取消相同订单仍返回 `200` 与同一订单，但：

```json
{
  "meta": {
    "alreadyCancelled": true
  }
}
```

重复取消不会第二次恢复座位。

常见错误：

- `400 INVALID_REQUEST`：`bookingId` 不合法。
- `404 BOOKING_NOT_FOUND`：订单不存在，或不属于当前用户。
- `409 BOOKING_NOT_CANCELLABLE`：订单当前不可取消，例如航班已起飞或状态不可预订。
- `503 BOOKING_WRITES_PAUSED`：维护期间暂停取消。
- `500 BOOKING_CONSISTENCY_ERROR`：服务端无法确认库存恢复或回滚结果，需要维护处理。

## 主要错误码速查

| HTTP 状态 | 错误码 | 含义 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 请求体、路径参数或查询参数不符合接口规则。 |
| 400 | `INVALID_ID` | 服务层收到的 ID 不是有效 ObjectId。 |
| 401 | `AUTH_REQUIRED` | 缺少或格式错误的 Bearer Token。 |
| 401 | `INVALID_CREDENTIALS` | 登录邮箱或密码错误。 |
| 401 | `INVALID_TOKEN` | Token 无效、签名不正确或用户不存在。 |
| 401 | `TOKEN_EXPIRED` | Token 已过期。 |
| 403 | `ACCOUNT_NOT_ACTIVE` | 用户状态不是 `ACTIVE`。 |
| 404 | `FLIGHT_NOT_FOUND` | 指定航班不存在。 |
| 404 | `BOOKING_NOT_FOUND` | 订单不存在或不属于当前用户。 |
| 404 | `ROUTE_NOT_FOUND` | 路由不存在。 |
| 409 | `EMAIL_ALREADY_REGISTERED` | 邮箱已注册。 |
| 409 | `FLIGHT_NOT_FOUND_OR_SOLD_OUT` | 航班不可预订或余票不足。 |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | 同一用户使用相同幂等 key 提交了不同预订请求。 |
| 409 | `BOOKING_NOT_CANCELLABLE` | 订单当前不能取消。 |
| 500 | `BOOKING_CREATION_FAILED` | 创建订单失败，系统已尝试恢复座位。 |
| 500 | `BOOKING_CONSISTENCY_ERROR` | 座位和订单的补偿或恢复状态无法安全确认。 |
| 503 | `BOOKING_WRITES_PAUSED` | 维护期间暂停创建/取消订单。 |

## 推荐调用流程

1. `POST /api/auth/register` 或 `POST /api/auth/login` 获取 JWT。
2. 使用 `GET /api/airports/search` 让用户选定具体出发/到达机场。
3. 使用 `GET /api/flights/search` 查询航班；客户端按 UTC 时间显示时应转换为需要展示的本地时区。
4. 用户确认后生成 UUID，并调用 `POST /api/bookings`。同一次预订的重试必须沿用同一个 UUID。
5. 使用 `GET /api/bookings/me` 展示订单；需要取消时调用 `PATCH /api/bookings/:bookingId/cancel`。

未来 AI 功能应调用同一组 API 或其后端服务封装；AI 不应直接访问 MongoDB，也不应绕过认证、余票校验或幂等预订规则。
