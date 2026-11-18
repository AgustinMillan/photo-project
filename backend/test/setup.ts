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
