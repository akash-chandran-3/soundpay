-- SoundPay schema. Run with: npm run db:init
-- (the init script creates the database itself, then runs this file)

CREATE TABLE IF NOT EXISTS payment_sessions (
  id            CHAR(36)     NOT NULL,              -- UUID, e.g. 3f2b...-...
  merchant_id   VARCHAR(50)  NOT NULL,
  route_id      VARCHAR(20)  NOT NULL,
  amount_paise  INT UNSIGNED NOT NULL,              -- money as whole paise: 2500 = Rs 25.00
  status        ENUM('PENDING', 'AUTHORIZED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME     NOT NULL,
  authorized_at DATETIME     NULL,
  PRIMARY KEY (id),
  INDEX idx_status_expires (status, expires_at)
);
