# Oracle Cloud Always Free (ARM64) Deployment Guide ($0/mo)

This guide deploys the isolated BEP-20 payout worker (`workers/payout-engine`) on an **Oracle Cloud Always Free `VM.Standard.A1.Flex` (Ampere ARM64)** instance with zero monthly compute fees.

---

## 1. Create the Free ARM VM in Oracle Cloud

1. Sign in to **Oracle Cloud Infrastructure (OCI)** -> **Compute** -> **Instances** -> **Create Instance**.
2. **Shape**: Choose **Ampere (`VM.Standard.A1.Flex`)**, **1 OCPU**, **6 GB RAM** (well inside the 4 OCPU / 24 GB Always Free limit).
3. **Image**: **Ubuntu 22.04 Minimal (aarch64)** or **Ubuntu 24.04 Minimal (aarch64)**.
4. **Networking / Security List**:
   - Allow **Ingress** TCP port `22` ONLY from **your IP address (`x.x.x.x/32`)**.
   - Allow **Egress** TCP ports `443` (BSC RPCs, Telegram, OCI Vault) and `5432` (Neon Postgres).
   - Do **not** open ports `80`, `3000`, or any API port on this VM.
5. Download your SSH `.key` file and connect:
   ```bash
   chmod 600 ~/.ssh/oracle_fetan.key
   ssh -i ~/.ssh/oracle_fetan.key ubuntu@<ORACLE_VM_PUBLIC_IP>
   ```

> **CRITICAL — Avoid the 7-Day Always Free Idle Reclaim:**
> Oracle can reclaim Free Tier VMs whose CPU, memory, and network stay below 20% for 7 days. Upgrading your OCI account to **Pay-As-You-Go (PAYG)** prevents idle reclamation while keeping `VM.Standard.A1.Flex` (up to 4 OCPU / 24 GB) completely **$0/mo**. Keep Billing Alerts configured in OCI for peace of mind.

---

## 2. Generate a Dedicated Hot Wallet (Separate from `DEPOSIT_XPUB`)

Never derive the hot wallet from your `DEPOSIT_XPUB` seed phrase. Generate a brand-new offline wallet locally:

```bash
node -e "const { Wallet } = require('ethers'); const w = Wallet.createRandom(); console.log('HOT_WALLET_ADDRESS=' + w.address); console.log('PRIVATE_KEY=' + w.privateKey);"
```

- Fund it ONLY with daily working liquidity (**1–2 days of payouts max**) plus ~`0.05 BNB` for gas.
- Keep your treasury reserve offline in cold storage.
- Start with **`PAYOUT_CHAIN_ID=97` (BSC Testnet)** first!

---

## 3. Harden the Oracle VM

Copy the deploy folder onto the VM and run `setup-oracle.sh`:

```bash
scp -i ~/.ssh/oracle_fetan.key -r workers/payout-engine/deploy ubuntu@<ORACLE_VM_IP>:~/deploy
ssh -i ~/.ssh/oracle_fetan.key ubuntu@<ORACLE_VM_IP> "sudo ADMIN_SSH_IP='YOUR.PUBLIC.IP' bash ~/deploy/setup-oracle.sh"
```

---

## 4. Store the Private Key Securely (Choose Option A or B)

### Option A (Recommended if Free in your OCI Region): OCI Vault + Instance Principal
1. Check **Identity & Security -> Vault -> Secrets**: verify KMS/Vault shows **$0 / Free** in your home region.
2. Create a Master Encryption Key + Secret containing ONLY the `0x...` private key.
3. Create a **Dynamic Group** matching this instance OCID, and grant an IAM policy:
   `Allow dynamic-group fetan-payout-vm to read secret-bundle in compartment <comp> where target.secret.id = '<SECRET_OCID>'`
4. Set `HOT_WALLET_KEY_SOURCE="oci-vault"`, `OCI_REGION`, and `OCI_VAULT_SECRET_OCID` in `/etc/fetan/payout.env`.

### Option B (Zero Extra Cloud Service): Root-Only `chmod 600` Systemd Credential File
```bash
sudo bash -c 'umask 077 && printf "0xYOUR_64_HEX_PRIVATE_KEY" > /etc/fetan/hot_wallet_key'
sudo chown root:root /etc/fetan/hot_wallet_key
sudo chmod 0600 /etc/fetan/hot_wallet_key
```
`fetan-payout.service` uses `LoadCredential=hot_wallet_key:/etc/fetan/hot_wallet_key`, so systemd exposes it solely inside the service's private `ramfs` mount and `fetan-payout` user can never read `/etc/fetan/hot_wallet_key` directly.

---

## 5. Create a Low-Privilege Neon DB Role (Recommended)

Instead of giving the signer VM superuser/owner access to Neon, create a restricted PostgreSQL role that can only read `User` (for balances/suspension) and manage `Withdrawal`, `WithdrawalBroadcast`, `WalletBalance`, `WalletTransaction`, and `PayoutControl`:

```sql
CREATE ROLE fetan_worker LOGIN PASSWORD 'STRONG_RANDOM_PASSWORD';
GRANT USAGE ON SCHEMA public TO fetan_worker;
GRANT SELECT, UPDATE ("usdtBalance") ON "User" TO fetan_worker;
GRANT SELECT, UPDATE ON "Withdrawal", "WalletTransaction", "PayoutControl" TO fetan_worker;
GRANT SELECT, INSERT ON "WithdrawalBroadcast", "WalletBalance" TO fetan_worker;
```

---

## 6. Build Locally & Deploy to `/opt/fetan-payout` (No GitHub Keys on Signer VM)

From your local repo on Windows PowerShell:

```powershell
# 1. Compile standalone worker JS bundle
npx tsc -p workers/payout-engine/tsconfig.json

# 2. Package bundle + runtime package.json + Prisma schema
New-Item -ItemType Directory -Force release-worker | Out-Null
Copy-Item -Recurse -Force workers/payout-engine/dist release-worker/
Copy-Item workers/payout-engine/package.json release-worker/
Copy-Item server/database/schema.prisma release-worker/

# 3. Upload to Oracle VM
scp -i ~/.ssh/oracle_fetan.key -r release-worker/* ubuntu@<ORACLE_VM_IP>:/tmp/fetan-payout/
```

On the Oracle VM:

```bash
sudo rsync -a --delete /tmp/fetan-payout/ /opt/fetan-payout/
cd /opt/fetan-payout
sudo npm install --omit=dev
sudo npx prisma generate --schema=./schema.prisma
sudo chown -R root:fetan-payout /opt/fetan-payout

# Configure /etc/fetan/payout.env (chmod 640, root:fetan-payout)
sudo cp ~/deploy/payout.env.example /etc/fetan/payout.env
sudo chown root:fetan-payout /etc/fetan/payout.env
sudo chmod 0640 /etc/fetan/payout.env
sudo nano /etc/fetan/payout.env

# Start and monitor logs
sudo systemctl enable --now fetan-payout
sudo journalctl -u fetan-payout -f
```

---

## 7. Dead-Man Switch Monitoring (Free)

Point **UptimeRobot** (free 5-minute check) at `https://your-vercel-domain.vercel.app/api/health`.
If the Oracle VM stops checking in for > 2 minutes, `/api/health` automatically sends a Telegram alert to `TELEGRAM_ADMIN_CHAT_ID`.
