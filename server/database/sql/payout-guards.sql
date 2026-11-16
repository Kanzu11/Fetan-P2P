-- Enterprise database-level invariants for Fetan P2P automatic payouts.
-- Attack surface defended:
--   1. Compromised web tier or SQL injection attempting illegal state jumps (e.g., PENDING -> COMPLETED).
--   2. Post-approval tampering with withdrawal amount, destination address, network, or nonce.
--   3. Re-queuing or auto-refunding an already-broadcast PROCESSING withdrawal (double-spend).
--   4. Tampering with or deleting append-only WalletBalance ledger rows.

CREATE OR REPLACE FUNCTION withdrawal_transition_guard() RETURNS trigger AS $$
BEGIN
  -- Terminal states are completely frozen against further mutation
  IF OLD.status IN ('COMPLETED', 'FAILED', 'REJECTED') THEN
    RAISE EXCEPTION 'Terminal withdrawal status % cannot be modified (id=%)', OLD.status, OLD.id;
  END IF;

  -- Core payout tuple is strictly immutable after creation
  IF NEW."userId" <> OLD."userId"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey"
     OR NEW."requestHash" <> OLD."requestHash"
     OR NEW."network" <> OLD."network"
     OR NEW."destination" <> OLD."destination"
     OR NEW."amountUsdt" <> OLD."amountUsdt"
     OR NEW."feeUsdt" <> OLD."feeUsdt"
     OR NEW."netAmountUsdt" <> OLD."netAmountUsdt"
     OR NEW."netAmountRaw" <> OLD."netAmountRaw" THEN
    RAISE EXCEPTION 'Withdrawal amount, destination, network, or identity fields are immutable (id=%)', OLD.id;
  END IF;

  -- Nonce and final txHash cannot change once bound
  IF OLD."nonce" IS NOT NULL AND NEW."nonce" IS DISTINCT FROM OLD."nonce" THEN
    RAISE EXCEPTION 'Withdrawal nonce % is immutable once bound (id=%)', OLD."nonce", OLD.id;
  END IF;
  IF OLD."txHash" IS NOT NULL AND NEW."txHash" IS DISTINCT FROM OLD."txHash" THEN
    RAISE EXCEPTION 'Withdrawal txHash is immutable once bound (id=%)', OLD.id;
  END IF;

  -- Enforce strict state machine transitions
  IF NOT (
    (OLD.status = 'MANUAL_REVIEW'        AND NEW.status IN ('PENDING', 'REJECTED')) OR
    (OLD.status = 'MANUAL_REVIEW'        AND NEW.status = 'COMPLETED' AND OLD."network" <> 'BEP20' AND NEW."txHash" IS NOT NULL) OR
    (OLD.status = 'PENDING'              AND NEW.status IN ('SIMULATING', 'REJECTED') AND OLD."nonce" IS NULL) OR
    (OLD.status = 'SIMULATING'           AND NEW.status IN ('PENDING', 'FAILED') AND OLD."nonce" IS NULL AND NEW."nonce" IS NULL) OR
    (OLD.status = 'SIMULATING'           AND NEW.status = 'PROCESSING' AND NEW."nonce" IS NOT NULL) OR
    (OLD.status = 'PROCESSING'           AND NEW.status IN ('PROCESSING', 'NEEDS_RECONCILIATION')) OR
    (OLD.status = 'PROCESSING'           AND NEW.status = 'COMPLETED' AND NEW."txHash" IS NOT NULL) OR
    (OLD.status = 'NEEDS_RECONCILIATION' AND NEW.status = 'COMPLETED' AND NEW."txHash" IS NOT NULL) OR
    (OLD.status = 'NEEDS_RECONCILIATION' AND NEW.status = 'FAILED') OR
    (OLD.status = NEW.status)
  ) THEN
    RAISE EXCEPTION 'Illegal withdrawal status transition: % -> % (id=%, nonce=%)',
      OLD.status, NEW.status, OLD.id, OLD."nonce";
  END IF;

  NEW."version" := OLD."version" + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS withdrawal_transition_guard ON "Withdrawal";
CREATE TRIGGER withdrawal_transition_guard
BEFORE UPDATE ON "Withdrawal"
FOR EACH ROW EXECUTE FUNCTION withdrawal_transition_guard();

-- Block any modification or deletion of append-only ledger records
CREATE OR REPLACE FUNCTION wallet_balance_immutability_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'WalletBalance ledger is append-only; updates are forbidden (id=%)', OLD.id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF current_setting('fetan.allow_test_ledger_cleanup', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'WalletBalance ledger is append-only; deletes are forbidden (id=%)', OLD.id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wallet_balance_immutable ON "WalletBalance";
CREATE TRIGGER wallet_balance_immutable
BEFORE UPDATE OR DELETE ON "WalletBalance"
FOR EACH ROW EXECUTE FUNCTION wallet_balance_immutability_guard();
