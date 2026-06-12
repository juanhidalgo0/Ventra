-- CreateTable
CREATE TABLE "app_licenses" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'license_config',
    "licenseKey" TEXT NOT NULL DEFAULT '',
    "machineUuid" TEXT NOT NULL DEFAULT '',
    "expiresAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
