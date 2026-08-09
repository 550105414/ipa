# 销售工作台搜索数据层

迁移按 `001 → 002 → 003 → 004` 顺序执行。`001` 假定基础表已经存在，字段映射如下：

- `customers`: `id`, `name`, `phone`, `id_card_front_url`, `id_card_back_url`, `created_at`
- `merchants`: `id`, `merchant_name`, `merchant_no`, `terminal_no`, `status`, `created_at`

如果基础模型中的身份证图片字段名称不同，需要在迁移中的完整度判断与敏感 RPC 处映射字段名。普通详情只返回上传状态，图片路径和内容不会进入全文/模糊搜索索引。

迁移会启用基础表 RLS，但不会创建任何放宽范围的新客户 policy。RPC 均为 `security invoker`，只向 `authenticated` 授权；调用者仍须具备基础表权限并通过现有 RLS policy。没有匹配 policy 时查询会安全地返回空结果。

服务端配置使用 `SUPABASE_URL` + `SUPABASE_ANON_KEY`（也兼容对应的 `NEXT_PUBLIC_` 名称）。不得把 service role key 填入 anon key。真实 Supabase 配置存在时，API 强制要求终端用户的 `Authorization: Bearer <access-token>`，上游错误不会降级为演示数据。

推荐客户端调用：

```http
POST /api/search
Content-Type: application/json
Authorization: Bearer <user-access-token>

{"q":"1380013","scope":"all","status":"all","period":"all","limit":20}
```

GET 搜索仅为兼容旧客户端保留。POST 可避免姓名、手机号片段进入 URL、浏览器历史、Referer 和常见访问日志。

## 敏感资料与银行卡

第二个迁移把银行卡资料放在未暴露给普通 PostgREST schema 的 `private.customer_sensitive_payment_data` 表中。它只保存：

- 使用 AES-256-GCM 加密的 PAN envelope；
- 明文 `last4`；
- 更新时间。

不会创建或接受 CVV、CVC、PIN、磁条数据、网银密码或银行卡密码字段。AES-GCM 每次使用随机 12-byte IV，128-bit tag，并以客户 UUID 作为 AAD 的一部分，防止密文被交换到另一客户。密钥错误、密文篡改或 AAD 不一致都会安全失败，不会回退明文。

敏感支付表自身启用 RLS，并且不向 `public`、`anon` 或 `authenticated` 授予表权限。敏感 RPC 同样撤销普通用户执行权限，仅允许 `service_role`。普通客户详情与搜索都只返回脱敏手机号，完整手机号仅由经过密码校验的 POST API 返回。

敏感请求采用两段式授权，顺序不可省略：

1. 使用终端用户 JWT 调用普通 `get_sales_workspace_customer` RPC；该 RPC 为 `security invoker`，只返回脱敏资料，并由现有 customers RLS 证明该用户可见此客户。
2. 完成密码常量时间校验与限速后，才允许隔离的服务端凭据调用敏感 RPC 或签名图片。

因此普通 authenticated 用户不能绕过应用密码直接调用敏感 RPC。搜索、普通详情和 RLS preflight 始终使用 anon key + 终端用户 JWT，绝不使用服务角色。

服务端还需配置以下 secret，均不得使用 `NEXT_PUBLIC_` 前缀：

- `SENSITIVE_VIEW_PASSWORD`：查看或修改敏感资料时提交的服务端密码；缺失时相关 API 返回 503。
- `BANK_CARD_ENCRYPTION_KEY`：标准 base64 编码、解码后严格为 32 字节的 AES key。
- `SUPABASE_ID_CARD_BUCKET`：私有身份证图片 bucket 名称。
- `SUPABASE_SENSITIVE_SERVICE_ROLE_KEY`：仅敏感 API helper 可读取的服务端 Supabase service-role/secret key。它不得等于 anon key，也不得出现对应的 `NEXT_PUBLIC_` 变量。

`id_card_front_url` / `id_card_back_url` 在敏感 RPC 中应保存为相对于该 bucket 的对象路径，而不是公开 URL。Storage 不应向终端 authenticated 用户授予身份证 bucket 的直接 SELECT；只有完成用户 JWT RLS preflight 与密码校验后，隔离的敏感服务 helper 才能创建约 300 秒的签名 URL。

推荐敏感调用：

```http
POST /api/customers/<customer-id>/sensitive
Content-Type: application/json
Authorization: Bearer <user-access-token>

{"password":"<server-password>"}
```

```http
PUT /api/customers/<customer-id>/bank-card
Content-Type: application/json
Authorization: Bearer <user-access-token>

{"password":"<server-password>","cardNumber":"<12-to-19-digit-PAN>"}
```

密码与 PAN 只能放在 JSON body，不得放进 URL、查询参数或日志。所有敏感响应均带 `private, no-store`、`Pragma: no-cache` 与 `Referrer-Policy: no-referrer`。

密码失败采用 SHA-256 digest 后的常量时间比较，并按已通过预检的用户 `sub` + 客户端 IP 做用户全局的 5 分钟内存窗口限速，随机更换客户 UUID 不会分散次数。该限速仅是单 Worker/进程的辅助防护；多实例生产环境必须在网关、共享 KV/数据库或 WAF 配置持久化全局限速。

## 新增客户与私有图片

`004_customer_creation_and_storage.sql` 创建私有 `id-cards` bucket、限制 10MB 的 JPG/PNG/WebP，并只允许 authenticated 用户写入自己 `auth.uid()/customerId/front|back` 路径；普通用户没有该 bucket 的 SELECT policy。`create_sales_workspace_customer` 会再次校验路径归属并以 `security invoker` 执行，因此现有 customers INSERT RLS 仍然生效。

`POST /api/customers` 在读取 multipart 内容之前先通过 `/auth/v1/user` 验证终端 JWT，再校验表单和可选银行卡密码。两张图片上传成功后才调用创建 RPC；失败会尽力清理已上传对象。Storage 与 PostgreSQL 无法共享事务，极端的响应丢失仍需在生产侧用 `customerId` 幂等状态或孤儿对象巡检补强。部署时 `SUPABASE_ID_CARD_BUCKET` 必须与迁移中的 `id-cards` 一致。

最后必须核查 Supabase Data API 的表暴露面：RLS 只限制“行”，不会给 `public.customers.phone`、`id_card_front_url`、`id_card_back_url` 增加列级密码门禁。如果 authenticated 仍能直接 SELECT 这些列，用户可绕过页面密码读取自己有行权限的数据。生产模型应将敏感列迁入不暴露 schema/加密表，或通过单独的受控数据库角色和 RPC 设计撤销客户端的直接列权限；完成该项验证前，不应导入真实客户资料。
