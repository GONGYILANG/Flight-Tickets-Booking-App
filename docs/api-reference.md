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
| 订单 | `GET` | `/api/bookings/:bookingId` | 是 |
| 订单 | `PATCH` | `/api/bookings/:bookingId/cancel` | 是 |
| 管理员 | `GET` | `/api/admin/users` | ADMIN |
| 管理员 | `GET` | `/api/admin/users/:userId` | ADMIN |
| 管理员 | `PATCH` | `/api/admin/users/:userId/status` | ADMIN |
| 管理员 | `GET` | `/api/admin/bookings` | ADMIN |
| 管理员 | `GET` | `/api/admin/bookings/:bookingId` | ADMIN |
| 管理员 | `PATCH` | `/api/admin/bookings/:bookingId/cancel` | ADMIN |
| 管理员 | `GET` | `/api/admin/flights` | ADMIN |
| 管理员 | `GET` | `/api/admin/flights/:flightId` | ADMIN |
| 管理员 | `PATCH` | `/api/admin/flights/:flightId/schedule` | ADMIN |
| 管理员 | `PATCH` | `/api/admin/flights/:flightId` | ADMIN |

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
- 航班搜索不会返回起飞时间小于或等于服务端当前时刻的航班。过去日期或已经结束的时段会正常返回空列表。
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
  "status": "ACTIVE",
  "role": "USER"
}
```

`status` 的可能值为 `ACTIVE`、`LOCKED`、`DISABLED`。
`role` 的可能值为 `USER`、`ADMIN`；注册接口始终创建 `USER`。

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
  "scheduledDepartureAt": "2026-12-08T00:30:00.000Z",
  "scheduledArrivalAt": "2026-12-08T04:00:00.000Z",
  "scheduleChanged": false,
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

- `scheduledDepartureAt`、`scheduledArrivalAt` 是首次排班时间，航变后仍保持不变。
- `departureAt`、`arrivalAt` 是当前生效时间，管理员航变会修改这两个字段。
- 当前时间与首次排班不同时，`scheduleChanged=true`。客户端可同时展示原定与最新时间。

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
  "cancellation": null,
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
      "status": "ACTIVE",
      "role": "USER"
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
      "status": "ACTIVE",
      "role": "USER"
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
        "scheduledDepartureAt": "2026-12-08T00:30:00.000Z",
        "scheduledArrivalAt": "2026-12-08T04:00:00.000Z",
        "scheduleChanged": false,
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
      "cancellation": null,
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

### `GET /api/bookings/:bookingId`

读取当前用户的一张订单，适用于订单详情页、通知跳转和 AI 精确复核。

认证：需要 Bearer Token。`bookingId` 必须是有效 MongoDB ObjectId。

成功返回 `200`：

```json
{
  "data": {
    "booking": { "...": "完整 Booking 对象" }
  }
}
```

- 只能读取当前 Token 所属用户的订单。
- 订单不存在或属于其他用户时统一返回 `404 BOOKING_NOT_FOUND`，避免泄露其他用户的订单是否存在。
- 响应不包含用户 ID、`idempotencyKey`、内部价格快照字段或 Mongoose 内部字段。

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
      "cancellation": {
        "source": "USER",
        "reason": null
      },
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

## 管理员 API

管理员继续使用 `POST /api/auth/login` 登录。所有 `/api/admin/*` 请求都必须携带 Bearer Token，且数据库中的当前用户必须同时满足：

```text
status = ACTIVE
role = ADMIN
```

普通用户访问管理接口返回 `403 ADMIN_REQUIRED`。管理员权限以数据库当前值为准，角色撤销或账号锁定后，已签发的 Token 也会立即失去管理权限。

### `GET /api/admin/users`

查询所有注册用户。

| 参数 | 必填 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `q` | 否 | — | 按邮箱或昵称进行不区分大小写的包含匹配，1–100 个字符。 |
| `status` | 否 | — | `ACTIVE`、`LOCKED`、`DISABLED`。 |
| `role` | 否 | — | `USER`、`ADMIN`。 |
| `page` | 否 | `1` | 整数，范围 `1–10000`。 |
| `limit` | 否 | `20` | 整数，范围 `1–50`。 |

结果按 `createdAt DESC, _id DESC` 排序：

```json
{
  "data": {
    "users": [
      {
        "id": "66a1b2c3d4e5f67890123456",
        "email": "student@example.com",
        "displayName": "Student",
        "status": "ACTIVE",
        "role": "USER",
        "createdAt": "2026-08-24T10:00:00.000Z",
        "updatedAt": "2026-08-24T10:00:00.000Z"
      }
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

### `GET /api/admin/users/:userId`

读取一个用户及其订单数量摘要：

```json
{
  "data": {
    "user": { "...": "管理员 User DTO" },
    "statusChange": null,
    "bookingSummary": {
      "total": 10,
      "confirmed": 7,
      "cancelled": 3
    }
  }
}
```

用户不存在时返回 `404 USER_NOT_FOUND`。

### `PATCH /api/admin/users/:userId/status`

锁定、停用或恢复用户：

```json
{
  "status": "LOCKED",
  "reason": "Suspicious account activity"
}
```

- `reason` 去除首尾空格后必须为 3–500 个字符。
- 任何当前为 `ACTIVE` 的管理员都不能通过此接口被锁定或停用，包括操作者本人。
- 相同状态重放返回 `meta.changed=false`。
- 接口不能修改邮箱、昵称、密码或角色。

### `GET /api/admin/bookings`

查询全部用户订单。支持：

```text
userId
flightId
bookingReference
status          CONFIRMED | CANCELLED
source          UI | AI
createdFrom     ISO 8601 时间
createdTo       ISO 8601 时间
page
limit
```

结果按 `createdAt DESC, _id DESC` 排序。每个管理员 Booking DTO 在普通 Booking DTO 基础上增加：

```json
{
  "user": {
    "id": "66a1b2c3d4e5f67890123456",
    "email": "student@example.com",
    "displayName": "Student",
    "status": "ACTIVE",
    "role": "USER"
  }
}
```

取消订单还会在 `cancellation.cancelledBy` 中返回取消操作者的安全用户摘要。响应不会包含 `idempotencyKey`、`priceSnapshot` 或 `passwordHash`。

### `GET /api/admin/bookings/:bookingId`

返回单个管理员 Booking DTO。不存在时返回 `404 BOOKING_NOT_FOUND`。

### `PATCH /api/admin/bookings/:bookingId/cancel`

管理员代用户取消尚未起飞航班的确认订单：

```json
{
  "reason": "Cancelled after customer support request"
}
```

- 订单必须为 `CONFIRMED`，航班必须为未来的 `SCHEDULED/DELAYED` 航班。
- 首次取消写入 `cancellation.source=ADMIN` 并恢复座位。
- 重复或并发取消不会再次恢复座位，返回 `meta.alreadyCancelled=true`。
- 不支持重新确认、编辑、删除或代创建订单。

### `GET /api/admin/flights`

查询全部航班，包括公共搜索不会列出的 `CANCELLED`、`DEPARTED`、`ARRIVED` 和过去航班。

| 参数 | 必填 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `flightNumber` | 否 | — | 2–12 位字母或数字，精确匹配。 |
| `airlineCode` | 否 | — | 2–3 位航空公司代码，必须存在。 |
| `origin` | 否 | — | 三位 IATA 机场代码，必须存在。 |
| `destination` | 否 | — | 三位 IATA 机场代码，不能与 `origin` 相同。 |
| `status` | 否 | — | 任一合法航班状态。 |
| `departureFrom` | 否 | — | ISO 8601 时间，包含该边界。 |
| `departureTo` | 否 | — | ISO 8601 时间，包含该边界且不得早于 `departureFrom`。 |
| `page` | 否 | `1` | 整数，范围 `1–10000`。 |
| `limit` | 否 | `20` | 整数，范围 `1–50`。 |
| `sortBy` | 否 | `departureAt` | `departureAt`、`arrivalAt`、`availableSeats`、`price`、`createdAt`。 |
| `sortOrder` | 否 | `asc` | `asc` 或 `desc`。 |

结果使用所选字段和 `_id` 进行稳定排序，每个元素都是管理员 Flight DTO，但列表不包含完整航变历史。

### `GET /api/admin/flights/:flightId`

读取一个管理员 Flight DTO。除公开 Flight 字段外，还会返回价格美分、状态操作审计、航变版本和完整航变历史：

```json
{
  "data": {
    "flight": {
      "...": "公开 Flight 字段",
      "priceCents": 42000,
      "statusUpdatedAt": "2026-08-24T10:00:00.000Z",
      "statusUpdatedBy": { "id": "...", "email": "admin@example.com" },
      "statusReason": "Operational delay",
      "scheduleVersion": 1,
      "scheduleUpdatedAt": "2026-08-24T10:00:00.000Z",
      "scheduleUpdatedBy": { "id": "...", "email": "admin@example.com" },
      "scheduleReason": "Operational delay",
      "scheduleChanges": [
        {
          "revision": 1,
          "previousDepartureAt": "2026-12-08T00:30:00.000Z",
          "previousArrivalAt": "2026-12-08T04:00:00.000Z",
          "departureAt": "2026-12-08T02:30:00.000Z",
          "arrivalAt": "2026-12-08T06:00:00.000Z",
          "changedAt": "2026-08-24T10:00:00.000Z",
          "changedBy": { "id": "...", "email": "admin@example.com" },
          "reason": "Operational delay"
        }
      ]
    }
  }
}
```

### `PATCH /api/admin/flights/:flightId/schedule`

原子修改尚未起飞的 `SCHEDULED/DELAYED` 航班当前起飞和抵达时间，同时保留首次排班和历史记录：

```json
{
  "departureAt": "2026-12-08T02:30:00.000Z",
  "arrivalAt": "2026-12-08T06:00:00.000Z",
  "expectedScheduleVersion": 0,
  "reason": "Operational delay"
}
```

规则：

- 两个时间都必填，必须带 `Z` 或 UTC offset，且 `arrivalAt > departureAt`。
- 新 `departureAt` 必须晚于服务端当前时间。
- `expectedScheduleVersion` 必须等于管理员最近读取到的 `scheduleVersion`；版本过期返回 `409 FLIGHT_SCHEDULE_CONFLICT`，防止两个管理员互相覆盖。
- 时间变更会递增版本并追加一条不可由 API 修改的 `scheduleChanges` 记录。
- 如果新起飞时间晚于首次排班且当前状态为 `SCHEDULED`，服务端会同时改为 `DELAYED`。
- 原 `scheduledDepartureAt/scheduledArrivalAt` 保持不变，已有订单会在其 Flight DTO 中看到最新时间。
- `meta.affectedBookings` 返回更新时仍为 `CONFIRMED` 的相关订单数量。
- 相同时间和当前版本重放返回 `meta.changed=false`，不会新增历史记录。

### `PATCH /api/admin/flights/:flightId`

修改航班价格、状态，或在一个请求中同时修改两者：

```json
{
  "status": "DELAYED",
  "priceCents": 42000,
  "reason": "Operational delay"
}
```

规则：

- 至少提供 `status` 或 `priceCents`，且只允许 `status`、`priceCents`、`reason` 三个字段。
- `priceCents` 必须是正的安全整数；只有 `SCHEDULED/DELAYED` 航班可调价。
- 调价不会修改已有订单的价格快照，新订单使用新价格。
- 提供 `status` 时，`reason` 必填且长度为 3–500。
- 状态转换只允许：
  - `SCHEDULED -> DELAYED | CANCELLED | DEPARTED`
  - `DELAYED -> SCHEDULED | CANCELLED | DEPARTED`
  - `DEPARTED -> ARRIVED`
- `CANCELLED`、`ARRIVED` 为终止状态；相同状态重放不重复改变状态。

成功响应中的管理员 Flight DTO在普通 Flight DTO 基础上增加：

```json
{
  "priceCents": 42000,
  "statusUpdatedAt": "2026-08-24T10:00:00.000Z",
  "statusUpdatedBy": { "id": "...", "email": "admin@example.com" },
  "statusReason": "Operational delay"
}
```

响应 `meta` 包含：

```json
{
  "changed": true,
  "changedFields": ["status", "priceCents"],
  "affectedBookings": 0
}
```

将航班改为 `CANCELLED` 时，服务端会取消该航班全部 `CONFIRMED` 订单、写入 `cancellation.source=FLIGHT`，并把 `availableSeats` 恢复为 `totalSeats`。重复请求会继续修复遗漏订单，但不会重复修改已取消订单。

管理端可使用管理员专用 GET 查询全部航班；当前版本仍不提供创建或删除航班接口，删除语义使用 `CANCELLED` 状态表示。

### 管理员角色和维护命令

现有用户、订单和航班在部署前执行默认只报告的迁移。该迁移也会识别缺少首次排班时间或 `scheduleVersion` 的旧航班：

```powershell
npm run migrate:admin
```

暂停 Booking 写入后应用迁移：

```powershell
$env:BOOKING_WRITES_PAUSED="true"
npm run migrate:admin -- --apply
```

授予管理员角色：

```powershell
npm run admin:role -- --email admin@example.com --role ADMIN --apply
```

检查航班取消与订单状态一致性：

```powershell
npm run reconcile:admin
```

修复时同样要求维护窗口和 `BOOKING_WRITES_PAUSED=true`。

## 主要错误码速查

| HTTP 状态 | 错误码 | 含义 |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | 请求体、路径参数或查询参数不符合接口规则。 |
| 400 | `INVALID_ID` | 服务层收到的 ID 不是有效 ObjectId。 |
| 400 | `ADMIN_REASON_REQUIRED` | 管理操作缺少有效原因。 |
| 400 | `INVALID_FLIGHT_SCHEDULE` | 航班抵达时间不晚于起飞时间。 |
| 401 | `AUTH_REQUIRED` | 缺少或格式错误的 Bearer Token。 |
| 401 | `INVALID_CREDENTIALS` | 登录邮箱或密码错误。 |
| 401 | `INVALID_TOKEN` | Token 无效、签名不正确或用户不存在。 |
| 401 | `TOKEN_EXPIRED` | Token 已过期。 |
| 403 | `ACCOUNT_NOT_ACTIVE` | 用户状态不是 `ACTIVE`。 |
| 403 | `ADMIN_REQUIRED` | 当前用户没有管理员权限。 |
| 404 | `FLIGHT_NOT_FOUND` | 指定航班不存在。 |
| 404 | `BOOKING_NOT_FOUND` | 订单不存在或不属于当前用户。 |
| 404 | `ROUTE_NOT_FOUND` | 路由不存在。 |
| 409 | `EMAIL_ALREADY_REGISTERED` | 邮箱已注册。 |
| 409 | `FLIGHT_NOT_FOUND_OR_SOLD_OUT` | 航班不可预订或余票不足。 |
| 409 | `IDEMPOTENCY_KEY_CONFLICT` | 同一用户使用相同幂等 key 提交了不同预订请求。 |
| 409 | `BOOKING_NOT_CANCELLABLE` | 订单当前不能取消。 |
| 409 | `ADMIN_STATUS_CHANGE_FORBIDDEN` | 不允许管理员锁定或停用自身及其他管理员。 |
| 409 | `INVALID_STATUS_TRANSITION` | 航班状态转换不合法。 |
| 409 | `FLIGHT_PRICE_NOT_EDITABLE` | 当前航班状态不允许调价。 |
| 409 | `FLIGHT_SCHEDULE_NOT_EDITABLE` | 当前航班状态不允许修改排班。 |
| 409 | `FLIGHT_SCHEDULE_CONFLICT` | 航变版本过期，或请求时间与其他航班实例冲突。 |
| 409 | `FLIGHT_SCHEDULE_IN_PAST` | 新起飞时间不是未来时间。 |
| 409 | `USER_STATUS_CONFLICT` | 用户状态被另一个请求同时修改。 |
| 409 | `FLIGHT_UPDATE_CONFLICT` | 航班被另一个请求同时修改。 |
| 500 | `BOOKING_CREATION_FAILED` | 创建订单失败，系统已尝试恢复座位。 |
| 500 | `BOOKING_CONSISTENCY_ERROR` | 座位和订单的补偿或恢复状态无法安全确认。 |
| 500 | `ADMIN_CONSISTENCY_ERROR` | 航班或订单管理操作需要一致性修复。 |
| 503 | `BOOKING_WRITES_PAUSED` | 维护期间暂停创建/取消订单。 |

## 推荐调用流程

1. `POST /api/auth/register` 或 `POST /api/auth/login` 获取 JWT。
2. 使用 `GET /api/airports/search` 让用户选定具体出发/到达机场。
3. 使用 `GET /api/flights/search` 查询航班；客户端按 UTC 时间显示时应转换为需要展示的本地时区。
4. 用户确认后生成 UUID，并调用 `POST /api/bookings`。同一次预订的重试必须沿用同一个 UUID。
5. 使用 `GET /api/bookings/me` 展示订单列表，使用 `GET /api/bookings/:bookingId` 打开详情；需要取消时调用 `PATCH /api/bookings/:bookingId/cancel`。

未来 AI 功能应调用同一组 API 或其后端服务封装；AI 不应直接访问 MongoDB，也不应绕过认证、余票校验或幂等预订规则。
