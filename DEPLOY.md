# Deploying Wealthflow

Wealthflow is one Node.js server that also serves the web pages, plus one database file
(`server/data/wealthflow.db`). It needs a host that keeps files on disk and can run Node 22.5 or newer.

**Use:** a small Linux VPS (recommended) or Render/Railway with a persistent disk.
**Don't use:** Vercel, Netlify or ordinary shared web hosting. They can't keep the database file, so
your data would disappear.

---

## Option A (recommended): a small VPS, about ₹500–1,000 a month

Any provider works: Hostinger VPS, DigitalOcean, AWS Lightsail or Linode. Choose **Ubuntu 24.04**,
1 GB RAM or more, and the **Mumbai / India** region.

### 1. Create the server
1. Buy the VPS and note its **IP address** and **root password** (or SSH key).
2. Optional: in your domain's DNS settings, add an **A record** such as `crm.yourdomain.in` pointing to
   that IP.

### 2. Connect to it
On Windows, open PowerShell and run `ssh root@YOUR_IP`.

### 3. Install Node 22, PM2, Nginx and unzip
```
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs nginx unzip
npm install -g pm2
```

### 4. Upload the app
From your Windows PC (a new PowerShell window, in the folder that has the zip):
```
scp wealthflow-source.zip root@YOUR_IP:/opt/
```
Back on the server:
```
cd /opt && unzip wealthflow-source.zip && cd wealthflow
npm run install:all
npm run build
```

### 5. Settings
```
cp server/.env.example server/.env
nano server/.env
```
Change these values, then save (Ctrl+O, Enter, Ctrl+X):
- `JWT_SECRET`: a long random string, for example the output of `openssl rand -hex 32`
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`: your real admin login, used only on first start
- Leave `PORT=5000` and `DATA_DIR=./data` as they are

### 6. Start it and keep it running
```
cd /opt/wealthflow/server
pm2 start src/index.js --name wealthflow
pm2 save && pm2 startup
```
Wealthflow now restarts by itself if it crashes or the server reboots. Check it with `pm2 status`,
and see errors with `pm2 logs wealthflow`.

### 7. Put it on your domain with HTTPS
```
cat > /etc/nginx/sites-available/wealthflow <<'EOF'
server {
  server_name crm.yourdomain.in;
  client_max_body_size 50M;
  location / { proxy_pass http://127.0.0.1:5000; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; }
}
EOF
ln -s /etc/nginx/sites-available/wealthflow /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d crm.yourdomain.in
```
Open `https://crm.yourdomain.in` and log in with the admin details from step 5.
(No domain yet? Skip this step, run `ufw allow 5000`, and open `http://YOUR_IP:5000`. Without HTTPS,
use this only for testing.)

### 8. Daily backup of the database
```
mkdir -p /opt/backups
(crontab -l; echo "0 2 * * * cp /opt/wealthflow/server/data/wealthflow.db /opt/backups/wealthflow-\$(date +\%F).db") | crontab -
```
Also download a copy to your PC now and then:
`scp root@YOUR_IP:/opt/wealthflow/server/data/wealthflow.db .`

### 9. Installing an update later
Upload `wealthflow-all-updates.zip`, then on the server:
```
cd /opt/wealthflow && unzip -o /opt/wealthflow-all-updates.zip
npm run install:all && npm run build
pm2 restart wealthflow
```
Your data in `server/data` isn't touched.

### Moving your current data (optional)
To keep what you've entered on your PC, stop the app on the PC and upload its database before step 6:
`scp server\data\wealthflow.db root@YOUR_IP:/opt/wealthflow/server/data/`

---

## On a VPS that already runs other projects

Wealthflow can sit next to them. It gets its own folder, its own port, its own PM2 name and its own
subdomain, and the other sites stay as they are.

1. **Check first** (nothing here changes anything):
   ```
   node -v                       # needs v22.5 or newer
   pm2 list                      # what is already running
   ss -ltnp | grep -E ':50[0-9][0-9]'   # ports already in use
   ls /etc/nginx/sites-enabled/  # existing sites
   ```
2. **Node version:** if `node -v` is older than 22.5, don't upgrade the system Node, because the other
   projects may need it. Install Node 22 just for Wealthflow with nvm:
   ```
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
   source ~/.bashrc && nvm install 22
   ```
   Then start it in step 4 with `pm2 start src/index.js --name wealthflow --interpreter $(nvm which 22)`.
3. **Pick a free port**, for example 5050, and set `PORT=5050` in `server/.env` (Option A step 5).
4. **Upload, install and start** exactly as in Option A steps 4 to 6, using `/opt/wealthflow`.
5. **New subdomain:** add a DNS A record such as `wealthflow.yourdomain.in` pointing to the same VPS IP.
   Then do Option A step 7 with that name and `proxy_pass http://127.0.0.1:5050`. Use a new file
   (`/etc/nginx/sites-available/wealthflow`) and don't edit the existing ones. `nginx -t` must say "ok"
   before you reload.
6. Run `certbot --nginx -d wealthflow.yourdomain.in`. This adds HTTPS for the new name only.

### Same subdomain, under /wealthflow

To run Wealthflow at `https://sub.yourdomain.in/wealthflow` next to the project that already runs there:

1. Do steps 1 to 3 above. In `server/.env`, set:
   ```
   PORT=5050
   BASE_PATH=/wealthflow
   ```
2. Build and start it. The build reads `BASE_PATH` from `server/.env`, so build **after** setting it:
   ```
   cd /opt/wealthflow && npm run install:all && npm run build
   cd server && pm2 start src/index.js --name wealthflow
   pm2 save
   ```
   Check it with `curl http://127.0.0.1:5050/wealthflow/api/health`. It should print `{"ok":true}`.
3. Back up your subdomain's Nginx file first:
   ```
   ls /etc/nginx/sites-enabled/
   cp /etc/nginx/sites-available/YOUR-SITE-FILE /root/YOUR-SITE-FILE.backup
   ```
4. Open it with `nano /etc/nginx/sites-available/YOUR-SITE-FILE`. Find the `server { ... }` block for
   your subdomain that has `listen 443 ssl` in it. Paste these lines inside it, just above its first
   `location` line, and change nothing else:
   ```
   location = /wealthflow { return 301 /wealthflow/; }
   location /wealthflow/ {
       client_max_body_size 50M;
       proxy_pass http://127.0.0.1:5050;
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $remote_addr;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```
5. Test, then reload. Only reload if the test says "syntax is ok" and "test is successful":
   ```
   nginx -t && systemctl reload nginx
   ```
   If the test fails, put the backup back with
   `cp /root/YOUR-SITE-FILE.backup /etc/nginx/sites-available/YOUR-SITE-FILE`. Your other project keeps
   running, because nothing reloads until the test passes.
6. Open `https://sub.yourdomain.in/wealthflow`. The existing HTTPS certificate already covers it.

Your other project stays at `https://sub.yourdomain.in` as before. Wealthflow uses only addresses that
start with `/wealthflow`.


---

## Option B: Render (no server to manage, about $7 a month plus disk)
1. Put the code in a private GitHub repository.
2. On render.com, create a **Web Service** from that repository.
   - Build command: `npm run install:all && npm run build`
   - Start command: `npm start`
   - Instance type: Starter (the free tier has no disk)
3. Add a **Disk** mounted at `/var/data`, size 1 GB.
4. Environment variables: `DATA_DIR=/var/data`, `JWT_SECRET=<long random string>`,
   `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `NODE_VERSION=22`.
5. Deploy. Render gives you an https address, and you can add your own domain under Settings.

Railway works the same way (add a Volume and set `DATA_DIR` to its mount path).

---

## Before real users log in
- Change the admin password from Admin Console after the first login.
- Don't run the demo seed or test pack on the live server.
- Keep backups (step 8). The whole database is that one file.
