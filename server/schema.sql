-- SoundPay schema. Run with: npm run db:init
-- (the init script creates the database itself, then runs this file)
-- Every statement is safe to run again, so db:init can run on every deploy.

CREATE TABLE IF NOT EXISTS payment_sessions (
  id            VARCHAR(36)  NOT NULL,              -- 12 random chars, e.g. k7qm2xpa9r4t
  merchant_id   VARCHAR(50)  NOT NULL,
  route_id      VARCHAR(20)  NOT NULL,
  amount_paise  INT UNSIGNED NOT NULL,              -- money as whole paise: 2500 = Rs 25.00
  status        ENUM('PENDING', 'PROCESSING', 'AUTHORIZED', 'FAILED', 'EXPIRED')
                NOT NULL DEFAULT 'PENDING',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME     NOT NULL,
  authorized_at DATETIME     NULL,
  PRIMARY KEY (id),
  INDEX idx_status_expires (status, expires_at)
);

-- Upgrade tables created by the first version (UUID ids, 3 statuses).
-- Re-running it on an already-upgraded table changes nothing.
ALTER TABLE payment_sessions
  MODIFY id VARCHAR(36) NOT NULL,
  MODIFY status ENUM('PENDING', 'PROCESSING', 'AUTHORIZED', 'FAILED', 'EXPIRED')
         NOT NULL DEFAULT 'PENDING';

-- One row per SIMULATED UPI transfer. UNIQUE(session_id) means a session can
-- have at most one transfer: a second guard against paying twice.
CREATE TABLE IF NOT EXISTS upi_transactions (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id    VARCHAR(36)  NOT NULL,
  payer_vpa     VARCHAR(100) NOT NULL,              -- e.g. kesav@mockbank
  payee_vpa     VARCHAR(100) NOT NULL,              -- e.g. bus-depot-1@mockbank
  amount_paise  INT UNSIGNED NOT NULL,
  status        ENUM('SUCCESS', 'FAILED') NOT NULL,
  rrn           CHAR(12)     NULL,                  -- 12-digit reference number (success only)
  error_code    VARCHAR(30)  NULL,
  steps         JSON         NOT NULL,              -- [{ step, message, atMs }, ...]
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_session (session_id),
  FOREIGN KEY (session_id) REFERENCES payment_sessions (id)
);
