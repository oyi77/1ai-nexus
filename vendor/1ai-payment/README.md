# @1ai/payment (local shim)

This directory is a **local placeholder** for the proprietary `@1ai/payment`
SDK referenced by `nexus` via:

```
"@1ai/payment": "file:../1ai-payment/packages/sdk/1ai-payment-0.1.0.tgz"
```

That internal package is not available in this environment, which caused
`npm install` to fail (ENOENT, exit 38) and blocked `prisma generate` /
`tsc`. This shim satisfies the import contract used by
`src/lib/payment-service.ts` (`OneAIPayment` + `Order` / `GatewayInfo` types)
so the app installs, type-checks, and builds.

## Contract implemented
- `new OneAIPayment({ apiKey, baseUrl? })`
- `.create(params) -> Order`
- `.get(orderId) -> Order`
- `.listGateways() -> GatewayInfo[]`

## Behavior
Payment calls are **no-ops** that return `pending` stub orders. Real payment
processing is unavailable until the genuine `@1ai/payment` package is
installed. To restore it: drop the real SDK at
`../1ai-payment/packages/sdk/1ai-payment-0.1.0.tgz` and revert the
`@1ai/payment` dependency in `package.json` to the original `file:` path.
