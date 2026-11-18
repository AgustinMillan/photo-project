process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? "silent";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://photo_platform:photo_platform_dev@localhost:5432/photo_platform_test";
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? "test-only-jwt-access-secret-at-least-32-chars";
process.env.MEDIA_ROOT =
  process.env.MEDIA_ROOT ??
  `${process.env.TMPDIR ?? "/tmp"}/photo-platform-test-media-${process.pid}`;
// Mercado Pago marketplace app (tests talk to a stubbed API, never the real one).
process.env.MP_CLIENT_ID = process.env.MP_CLIENT_ID ?? "test-client-id";
process.env.MP_CLIENT_SECRET = process.env.MP_CLIENT_SECRET ?? "test-client-secret";
process.env.MP_WEBHOOK_SECRET =
  process.env.MP_WEBHOOK_SECRET ?? "test-webhook-secret, test-mode-secret";
process.env.MP_API_BASE = "https://mp.test";
process.env.MP_AUTH_BASE = "https://auth.mp.test";
process.env.APP_URL = process.env.APP_URL ?? "http://localhost:5173";
